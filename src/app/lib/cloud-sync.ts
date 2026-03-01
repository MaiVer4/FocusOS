/**
 * Cloud Sync — Sincronización bidireccional entre localStorage y Firebase Firestore.
 *
 * Arquitectura:
 *  - localStorage es la fuente primaria (rápida, funciona offline).
 *  - Firestore es el respaldo en la nube (sync entre dispositivos).
 *  - Cada escritura local se sube a Firestore (debounced 1.5 s).
 *  - onSnapshot escucha cambios remotos y los baja a localStorage.
 */

import {
  signInWithGoogleToken,
  saveUserData,
  loadUserData,
  onUserDataChange,
  getFirebaseUser,
  signOutFirebase,
} from './firebase';
import { googleAuth } from './google-auth';
import type { Unsubscribe } from 'firebase/firestore';

// ─── Constantes ─────────────────────────────────────────────────────────────

const COLLECTIONS = ['tasks', 'blocks', 'metrics', 'settings'] as const;
type Collection = (typeof COLLECTIONS)[number];

/** Mapeo colección → clave de localStorage */
const STORAGE_KEYS: Record<Collection, string> = {
  tasks: 'focusos_tasks',
  blocks: 'focusos_blocks',
  metrics: 'focusos_metrics',
  settings: 'focusos_settings',
};

const DEBOUNCE_MS = 1500;       // esperar 1.5 s antes de subir
const ECHO_WINDOW_MS = 3000;    // ignorar escrituras propias dentro de 3 s

// ─── CloudSync ──────────────────────────────────────────────────────────────

class CloudSync {
  private active = false;
  private connecting = false;
  private lastWriteTs: Record<string, number> = {};
  private debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private unsubscribers: Unsubscribe[] = [];
  private changeCallbacks: Array<() => void> = [];

  // ── Pub / Sub para cambios remotos ──────────────────────────────────────

  /** Suscribe a notificaciones de cambio remoto. Devuelve función para desuscribir. */
  onRemoteChange(fn: () => void): () => void {
    this.changeCallbacks.push(fn);
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter(cb => cb !== fn);
    };
  }

  private notifyRemoteChange(): void {
    this.changeCallbacks.forEach(fn => fn());
  }

  // ── Conexión ────────────────────────────────────────────────────────────

  /**
   * Conecta a Firebase con el token de Google existente
   * y activa sincronización bidireccional.
   */
  async connect(): Promise<boolean> {
    if (this.active) return true;
    if (this.connecting) return false;
    this.connecting = true;

    try {
      const token = googleAuth.getAccessToken();
      if (!token) {
        this.connecting = false;
        return false;
      }

      await signInWithGoogleToken(token);

      if (!getFirebaseUser()) {
        this.connecting = false;
        return false;
      }

      console.log('[CloudSync] Conectado a Firebase');

      // 1. Sync inicial: merge local ↔ nube
      await this.initialSync();

      // 2. Escuchar cambios remotos en tiempo real
      this.startListening();

      this.active = true;
      this.connecting = false;
      return true;
    } catch (e) {
      console.error('[CloudSync] Error de conexión:', e);
      this.connecting = false;
      return false;
    }
  }

  // ── Subida (debounced) ──────────────────────────────────────────────────

  /** Sube datos a Firestore con debounce para evitar escrituras rápidas consecutivas. */
  uploadDebounced(collection: string, data: unknown): void {
    if (!this.active) return;

    if (this.debounceTimers[collection]) {
      clearTimeout(this.debounceTimers[collection]);
    }

    this.debounceTimers[collection] = setTimeout(async () => {
      try {
        this.lastWriteTs[collection] = Date.now();
        await saveUserData(collection, data);
      } catch (e) {
        console.error(`[CloudSync] Error subiendo ${collection}:`, e);
      }
    }, DEBOUNCE_MS);
  }

  // ── Sync inicial ───────────────────────────────────────────────────────

  private async initialSync(): Promise<void> {
    for (const collection of COLLECTIONS) {
      const storageKey = STORAGE_KEYS[collection];

      try {
        const cloudData = await loadUserData<unknown>(collection);
        const localRaw = localStorage.getItem(storageKey);
        const localData = localRaw ? JSON.parse(localRaw) : null;

        if (cloudData && !localData) {
          // Nube tiene datos, local vacío → usar nube
          localStorage.setItem(storageKey, JSON.stringify(cloudData));
          console.log(`[CloudSync] ${collection}: cargado desde la nube`);
        } else if (!cloudData && localData) {
          // Local tiene datos, nube vacía → subir
          this.lastWriteTs[collection] = Date.now();
          await saveUserData(collection, localData);
          console.log(`[CloudSync] ${collection}: subido a la nube`);
        } else if (cloudData && localData) {
          if (collection === 'settings') {
            // Settings: dispositivo actual gana
            this.lastWriteTs[collection] = Date.now();
            await saveUserData(collection, localData);
          } else {
            // Arrays (tasks, blocks, metrics): merge por ID, local gana en conflictos
            const merged = this.mergeArrays(
              localData as Array<{ id: string }>,
              cloudData as Array<{ id: string }>,
            );
            localStorage.setItem(storageKey, JSON.stringify(merged));
            this.lastWriteTs[collection] = Date.now();
            await saveUserData(collection, merged);
            console.log(`[CloudSync] ${collection}: merge (${merged.length} items)`);
          }
        }
      } catch (e) {
        console.error(`[CloudSync] Error sync inicial (${collection}):`, e);
      }
    }

    // Notificar a la app para que recargue datos mergeados
    this.notifyRemoteChange();
  }

  /**
   * Merge dos arrays por ID. Items locales ganan sobre remotos.
   */
  private mergeArrays<T extends { id: string }>(local: T[], cloud: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of cloud) map.set(item.id, item);   // nube primero
    for (const item of local) map.set(item.id, item);   // local sobrescribe
    return Array.from(map.values());
  }

  // ── Escucha en tiempo real ──────────────────────────────────────────────

  private startListening(): void {
    this.stopListening();

    for (const collection of COLLECTIONS) {
      const storageKey = STORAGE_KEYS[collection];

      const unsub = onUserDataChange(collection, (data: unknown, updatedAt: number) => {
        // Ignorar eco de nuestras propias escrituras
        const lastWrite = this.lastWriteTs[collection] || 0;
        if (Math.abs(updatedAt - lastWrite) < ECHO_WINDOW_MS) return;

        if (data !== null && data !== undefined) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(data));
            console.log(`[CloudSync] Cambio remoto: ${collection}`);
            this.notifyRemoteChange();
          } catch (e) {
            console.error(`[CloudSync] Error aplicando remoto ${collection}:`, e);
          }
        }
      });

      this.unsubscribers.push(unsub);
    }
  }

  private stopListening(): void {
    this.unsubscribers.forEach(fn => fn());
    this.unsubscribers = [];
  }

  // ── Desconexión ─────────────────────────────────────────────────────────

  disconnect(): void {
    this.stopListening();
    Object.values(this.debounceTimers).forEach(t => clearTimeout(t));
    this.debounceTimers = {};
    this.lastWriteTs = {};
    this.active = false;
    signOutFirebase().catch(() => {});
    console.log('[CloudSync] Desconectado');
  }

  isActive(): boolean {
    return this.active;
  }
}

export const cloudSync = new CloudSync();
