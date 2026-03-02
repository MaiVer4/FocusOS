/**
 * Cloud Sync — Sincronización bidireccional localStorage ↔ Firebase Firestore.
 *
 * Arquitectura:
 *  - localStorage = cache rápido, funciona offline.
 *  - Firestore = fuente de verdad compartida entre dispositivos.
 *  - Cada escritura local se sube a Firestore (debounced).
 *  - onSnapshot escucha cambios remotos y los baja.
 *  - El sync vive a nivel de app, NO se desconecta al cambiar de página.
 */

import {
  signInWithGoogleToken,
  saveUserData,
  loadUserData,
  onUserDataChange,
  getFirebaseUser,
  auth,
} from './firebase';
import { googleAuth } from './google-auth';
import type { Unsubscribe } from 'firebase/firestore';

// ─── Constantes ─────────────────────────────────────────────────────────────

const COLLECTIONS = ['tasks', 'blocks', 'metrics', 'settings'] as const;
type Collection = (typeof COLLECTIONS)[number];

const STORAGE_KEYS: Record<Collection, string> = {
  tasks: 'focusos_tasks',
  blocks: 'focusos_blocks',
  metrics: 'focusos_metrics',
  settings: 'focusos_settings',
};

const DEBOUNCE_MS = 800;

// ID único de esta instancia/pestaña para distinguir escrituras propias
const DEVICE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ─── CloudSync ──────────────────────────────────────────────────────────────

class CloudSync {
  private active = false;
  private connecting = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private pendingUploads: Record<string, unknown> = {};
  private unsubscribers: Unsubscribe[] = [];
  private changeCallbacks: Array<() => void> = [];

  private async waitForRestoredFirebaseSession(timeoutMs = 2500): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (getFirebaseUser() || auth.currentUser) return true;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return !!(getFirebaseUser() || auth.currentUser);
  }

  // ── Pub/Sub para cambios remotos ────────────────────────────────────────

  onRemoteChange(fn: () => void): () => void {
    this.changeCallbacks.push(fn);
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter(cb => cb !== fn);
    };
  }

  private notifyRemoteChange(): void {
    this.changeCallbacks.forEach(fn => {
      try { fn(); } catch (e) { console.error('[CloudSync] callback error:', e); }
    });
  }

  // ── Conexión ────────────────────────────────────────────────────────────

  async connect(): Promise<boolean> {
    if (this.active) return true;
    if (this.connecting) return false;
    this.connecting = true;

    // Descartar uploads acumulados durante la inicialización del Store.
    // Esos datos vienen del localStorage local (posiblemente obsoleto).
    // Después de initialSync el store se recargará con los datos correctos de la nube.
    for (const timer of Object.values(this.debounceTimers)) clearTimeout(timer);
    this.debounceTimers = {};
    this.pendingUploads = {};

    try {
      // 1) Preferir sesión Firebase ya restaurada (persiste entre recargas)
      await this.waitForRestoredFirebaseSession();
      const existingFirebaseUser = getFirebaseUser() ?? auth.currentUser;

      // 2) Si no hay sesión Firebase, intentar sign-in con token GIS
      let token = googleAuth.getAccessToken();
      if (!existingFirebaseUser && !token && googleAuth.wasConnected()) {
        const renewed = await googleAuth.tryAutoRenew();
        if (renewed) token = googleAuth.getAccessToken();
      }

      if (!existingFirebaseUser && !token) {
        this.connecting = false;
        if (googleAuth.wasConnected()) {
          this.scheduleRetry(15_000);
        }
        return false;
      }

      if (!existingFirebaseUser && token) {
        await signInWithGoogleToken(token);
      }

      // Sync inicial
      await this.initialSync();

      // Escuchar cambios en tiempo real
      this.startListening();

      // Subir uploads que se acumularon antes de estar activo
      this.flushPending();

      this.active = true;
      this.connecting = false;
      console.log('[CloudSync] ✅ Conectado (device:', DEVICE_ID, ')');
      return true;
    } catch (e) {
      console.error('[CloudSync] Error de conexión:', e);
      this.connecting = false;
      this.scheduleRetry(15_000);
      return false;
    }
  }

  private scheduleRetry(delay: number): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  // ── Subida ──────────────────────────────────────────────────────────────

  /**
   * Encola datos para subir a Firestore.
   * Si aún no estamos conectados, se acumula y se sube al conectar.
   */
  uploadDebounced(collection: string, data: unknown): void {
    // Guardar siempre para flush posterior
    this.pendingUploads[collection] = data;

    if (this.debounceTimers[collection]) {
      clearTimeout(this.debounceTimers[collection]);
    }

    this.debounceTimers[collection] = setTimeout(() => {
      if (!this.active) return; // se subirá en flushPending al conectar
      this.doUpload(collection, this.pendingUploads[collection]);
      delete this.pendingUploads[collection];
    }, DEBOUNCE_MS);
  }

  private async doUpload(collection: string, data: unknown): Promise<void> {
    try {
      await saveUserData(collection, data, DEVICE_ID);
    } catch (e) {
      console.error(`[CloudSync] Error subiendo ${collection}:`, e);
    }
  }

  /** Sube todos los uploads pendientes acumulados antes de conectar */
  private async flushPending(): Promise<void> {
    const entries = Object.entries(this.pendingUploads);
    this.pendingUploads = {};
    for (const [collection, data] of entries) {
      await this.doUpload(collection, data);
    }
  }

  // ── Sync inicial ───────────────────────────────────────────────────────

  /**
   * Sync al conectar.
   *
   * Regla fundamental: la NUBE es la fuente de verdad.
   * - Si nube tiene datos → usarlos directamente (respeta eliminaciones remotas).
   * - Sólo se agregan al resultado los items locales que NO existen en nube
   *   (= adiciones offline en este dispositivo).
   * - Sólo se escribe de vuelta a Firestore si hubo adiciones locales nuevas,
   *   para evitar race conditions que resucitan items eliminados.
   */
  private async initialSync(): Promise<void> {
    for (const collection of COLLECTIONS) {
      const storageKey = STORAGE_KEYS[collection];

      try {
        const cloudData = await loadUserData<unknown>(collection);
        const localRaw = localStorage.getItem(storageKey);
        const localData = localRaw ? JSON.parse(localRaw) : null;

        if (cloudData === null && !localData) {
          // Nada que sincronizar
        } else if (cloudData === null && localData) {
          // Primera vez en este dispositivo: subir local a la nube
          await saveUserData(collection, localData, DEVICE_ID);
          console.log(`[CloudSync] ${collection}: subido a la nube (primera vez)`);
        } else {
          // La nube tiene datos → LA NUBE SIEMPRE GANA.
          // Esto respeta eliminaciones, actualizaciones y cualquier cambio remoto.
          // NO fusionar con datos locales: el local puede estar desactualizado.
          localStorage.setItem(storageKey, JSON.stringify(cloudData));
          console.log(`[CloudSync] ${collection}: nube aplicada (${Array.isArray(cloudData) ? (cloudData as unknown[]).length + ' items' : 'settings'})`);
        }
      } catch (e) {
        console.error(`[CloudSync] Error sync inicial ${collection}:`, e);
      }
    }

    this.notifyRemoteChange();
  }

  // ── Escucha en tiempo real ──────────────────────────────────────────────

  private startListening(): void {
    this.stopListening();

    for (const collection of COLLECTIONS) {
      const storageKey = STORAGE_KEYS[collection];

      const unsub = onUserDataChange(
        collection,
        (data: unknown, _updatedAt: number, writerDeviceId?: string) => {
          // Ignorar escrituras propias
          if (writerDeviceId === DEVICE_ID) return;

          if (data !== null && data !== undefined) {
            try {
              localStorage.setItem(storageKey, JSON.stringify(data));
              console.log(`[CloudSync] 📥 Cambio remoto: ${collection}`);
              this.notifyRemoteChange();
            } catch (e) {
              console.error(`[CloudSync] Error aplicando ${collection}:`, e);
            }
          }
        },
      );

      this.unsubscribers.push(unsub);
    }
  }

  private stopListening(): void {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  isActive(): boolean {
    return this.active;
  }
}

export const cloudSync = new CloudSync();
