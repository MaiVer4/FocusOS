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
  loadUserDataWithMeta,
  loadUserDataFromServer,
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
const META_KEY = 'focusos_sync_meta';

const DEBOUNCE_MS = 800;

// ID único de esta instancia/pestaña para distinguir escrituras propias
const DEVICE_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export type CloudSyncStatus = 'disconnected' | 'connecting' | 'retrying' | 'syncing' | 'connected';

// ─── CloudSync ──────────────────────────────────────────────────────────────

class CloudSync {
  private active = false;
  private connecting = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private pendingUploads: Record<string, unknown> = {};
  private unsubscribers: Unsubscribe[] = [];
  private changeCallbacks: Array<() => void> = [];
  private status: CloudSyncStatus = 'disconnected';
  private statusCallbacks: Array<(status: CloudSyncStatus) => void> = [];
  private pullInProgress = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly POLL_INTERVAL_MS = 3_000;

  /** Funciones clave para cada colección que es un array mergeable */
  private static readonly ARRAY_KEY_FN: Record<string, (item: any) => string> = {
    tasks: (item) => item.id,
    blocks: (item) => item.id,
    metrics: (item) => item.date,
  };

  /** IDs eliminados localmente, pendientes de propagar a la nube */
  private localDeletions: Record<string, Set<string>> = {};

  constructor() {
    this.installLifecycleHandlers();
  }

  // ── Merge helpers ───────────────────────────────────────────────────────

  /** Registra una eliminación local para que el merge no resucite el item */
  trackDeletion(collection: string, id: string): void {
    if (!this.localDeletions[collection]) this.localDeletions[collection] = new Set();
    this.localDeletions[collection].add(id);
  }

  /** Registra múltiples eliminaciones locales */
  trackDeletions(collection: string, ids: string[]): void {
    if (!this.localDeletions[collection]) this.localDeletions[collection] = new Set();
    for (const id of ids) this.localDeletions[collection].add(id);
  }

  /**
   * Merge dos arrays por clave única.
   * - `primary` siempre gana para items que existen en ambos.
   * - Items solo en `secondary` se agregan (salvo los de `deletions`).
   */
  private mergeByKey(
    primary: unknown[],
    secondary: unknown[],
    keyFn: (item: any) => string,
    deletions?: Set<string>,
  ): unknown[] {
    const primaryKeys = new Set(primary.map(keyFn));
    const merged = [...primary];
    for (const item of secondary) {
      const key = keyFn(item);
      if (!primaryKeys.has(key) && !deletions?.has(key)) {
        merged.push(item);
      }
    }
    return merged;
  }

  /** ¿Hay cambios locales pendientes de subir para esta colección? */
  private hasPendingChanges(collection: string): boolean {
    return !!(this.pendingUploads[collection] || this.debounceTimers[collection]);
  }

  // ── Lifecycle: visibilitychange + online ─────────────────────────────────

  private installLifecycleHandlers(): void {
    // Cuando la pestaña cambia de visibilidad
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (this.active) {
          // Flush uploads que pudieron quedar atascados por throttle de mobile
          this.flushPending();
          // Pull inmediato + reanudar polling
          this.pullFromCloud();
          this.startPolling();
        } else if (!this.connecting) {
          this.connect();
        }
      } else {
        // Pestaña oculta → pausar polling para ahorrar batería
        this.stopPolling();
      }
    });

    // Cuando vuelve la red, reconectar
    window.addEventListener('online', () => {
      if (!this.active && !this.connecting) {
        this.connect();
      } else if (this.active) {
        // Red de vuelta → pull inmediato + reanudar polling
        this.pullFromCloud();
        this.startPolling();
      }
    });
  }

  // ── Polling periódico ─────────────────────────────────────────────────

  private startPolling(): void {
    // No duplicar timers
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      // Solo si seguimos activos y la página es visible
      if (!this.active || document.visibilityState !== 'visible') {
        this.stopPolling();
        return;
      }
      this.pullFromCloud();
    }, CloudSync.POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private loadMeta(): Partial<Record<Collection, number>> {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (!raw) return {};
      return JSON.parse(raw) as Partial<Record<Collection, number>>;
    } catch {
      return {};
    }
  }

  private saveMeta(meta: Partial<Record<Collection, number>>): void {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch {
      // ignore
    }
  }

  private getLocalUpdatedAt(collection: Collection): number {
    const meta = this.loadMeta();
    return meta[collection] ?? 0;
  }

  private setLocalUpdatedAt(collection: Collection, ts: number): void {
    const meta = this.loadMeta();
    meta[collection] = ts;
    this.saveMeta(meta);
  }

  private async waitForRestoredFirebaseSession(timeoutMs = 2500): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (getFirebaseUser() || auth.currentUser) return true;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return !!(getFirebaseUser() || auth.currentUser);
  }

  // ── Pub/Sub para cambios remotos ────────────────────────────────────────

  onStatusChange(fn: (status: CloudSyncStatus) => void): () => void {
    this.statusCallbacks.push(fn);
    fn(this.status);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter(cb => cb !== fn);
    };
  }

  getStatus(): CloudSyncStatus {
    return this.status;
  }

  private setStatus(next: CloudSyncStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.statusCallbacks.forEach(fn => {
      try { fn(next); } catch (e) { console.error('[CloudSync] status callback error:', e); }
    });
  }

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
    this.setStatus('connecting');

    // Descartar uploads acumulados durante la inicialización del Store.
    // Esos datos vienen del localStorage local (posiblemente obsoleto).
    // Después de initialSync el store se recargará con los datos correctos de la nube.
    for (const timer of Object.values(this.debounceTimers)) clearTimeout(timer);
    this.debounceTimers = {};
    // Restaurar meta timestamps que uploadDebounced pudo haber adelantado espuriamente
    const metaBeforeDiscard = this.loadMeta();
    for (const col of Object.keys(this.pendingUploads)) {
      // Si había un pending upload, su timestamp fue adelantado; revertirlo
      if ((COLLECTIONS as readonly string[]).includes(col)) {
        delete metaBeforeDiscard[col as Collection];
      }
    }
    this.saveMeta(metaBeforeDiscard);
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
        } else {
          this.setStatus('disconnected');
        }
        return false;
      }

      if (!existingFirebaseUser && token) {
        await signInWithGoogleToken(token);
      }

      // Confirmar que ya hay sesión Firebase activa antes de acceder a Firestore
      const activeUser = getFirebaseUser() ?? auth.currentUser;
      if (!activeUser) {
        this.connecting = false;
        if (googleAuth.wasConnected()) {
          this.scheduleRetry(15_000);
        } else {
          this.setStatus('disconnected');
        }
        return false;
      }

      // Sync inicial
      await this.initialSync();

      // Escuchar cambios en tiempo real
      this.startListening();

      // Subir uploads que se acumularon antes de estar activo
      this.flushPending();

      this.active = true;
      this.connecting = false;
      this.setStatus('connected');

      // Iniciar polling periódico para atrapar cambios que onSnapshot pierda
      this.startPolling();

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
    this.setStatus('retrying');
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

    // Solo actualizar meta timestamp cuando la sync está activa
    // (evita adelantar timestamps antes de initialSync)
    if (this.active && (COLLECTIONS as readonly string[]).includes(collection)) {
      this.setLocalUpdatedAt(collection as Collection, Date.now());
    }

    if (this.active) this.setStatus('syncing');

    if (this.debounceTimers[collection]) {
      clearTimeout(this.debounceTimers[collection]);
    }

    this.debounceTimers[collection] = setTimeout(async () => {
      if (!this.active) return; // se subirá en flushPending al conectar
      const data = this.pendingUploads[collection];
      const ok = await this.doUpload(collection, data);
      if (ok) {
        delete this.pendingUploads[collection];
      }
      // Si falló, se queda en pendingUploads para el próximo flush
    }, DEBOUNCE_MS);
  }

  /**
   * Sube a Firestore con merge: antes de escribir, lee la nube y
   * agrega items remotos que no existan en local (adiciones de otro dispositivo).
   * Respeta localDeletions para no resucitar items eliminados localmente.
   */
  private async doUpload(collection: string, data: unknown): Promise<boolean> {
    try {
      if (this.active) this.setStatus('syncing');

      let dataToUpload = data;
      const keyFn = CloudSync.ARRAY_KEY_FN[collection];

      // Para colecciones array, merge con la nube para preservar adiciones remotas
      if (keyFn && Array.isArray(data)) {
        try {
          const cloud = await loadUserDataFromServer<unknown[]>(collection);
          if (cloud.exists && Array.isArray(cloud.value) && cloud.value.length > 0) {
            const deletions = this.localDeletions[collection];
            const merged = this.mergeByKey(data, cloud.value, keyFn, deletions);
            if (merged.length !== data.length) {
              dataToUpload = merged;
              // Actualizar localStorage con el resultado mergeado
              const storageKey = STORAGE_KEYS[collection as Collection];
              if (storageKey) {
                localStorage.setItem(storageKey, JSON.stringify(merged));
                this.notifyRemoteChange();
              }
            }
          }
        } catch {
          // Si falla la lectura previa, subir local tal cual
        }
      }

      await saveUserData(collection, dataToUpload, DEVICE_ID);

      // Limpiar deletions después de upload exitoso
      delete this.localDeletions[collection];

      if (this.active) this.setStatus('connected');
      return true;
    } catch (e) {
      console.error(`[CloudSync] Error subiendo ${collection}:`, e);
      if (this.active) this.setStatus('connected');
      return false;
    }
  }

  /** Sube inmediatamente sin debounce (para datos críticos como settings) */
  uploadImmediate(collection: string, data: unknown): void {
    if ((COLLECTIONS as readonly string[]).includes(collection)) {
      this.setLocalUpdatedAt(collection as Collection, Date.now());
    }
    // Cancelar debounce pendiente si hay
    if (this.debounceTimers[collection]) {
      clearTimeout(this.debounceTimers[collection]);
      delete this.debounceTimers[collection];
    }
    delete this.pendingUploads[collection];
    if (this.active) {
      this.doUpload(collection, data);
    }
  }

  /** Sube todos los uploads pendientes acumulados */
  private async flushPending(): Promise<void> {
    const entries = Object.entries(this.pendingUploads);
    if (entries.length === 0) return;
    if (this.active) this.setStatus('syncing');
    for (const [collection, data] of entries) {
      const ok = await this.doUpload(collection, data);
      if (ok) {
        // Solo borrar si se subió con éxito
        if (this.pendingUploads[collection] === data) {
          delete this.pendingUploads[collection];
        }
      }
    }
    if (this.active) this.setStatus('connected');
  }

  /**
   * Descarga cambios recientes desde Firestore que onSnapshot pudo haber perdido
   * (ej: dispositivo en background, WebSocket caído, etc.)
   */
  private async pullFromCloud(): Promise<void> {
    if (!this.active || this.pullInProgress) return;
    this.pullInProgress = true;
    let changed = false;

    try {
      for (const collection of COLLECTIONS) {
        try {
          // Forzar lectura del SERVIDOR (getDocFromServer) para no leer caché obsoleto
          const cloud = await loadUserDataFromServer<unknown>(collection);
          if (!cloud.exists || cloud.value === null || cloud.value === undefined) continue;

          const localUpdatedAt = this.getLocalUpdatedAt(collection);
          if (cloud.updatedAt > localUpdatedAt) {
            const storageKey = STORAGE_KEYS[collection];
            const keyFn = CloudSync.ARRAY_KEY_FN[collection];
            let finalData = cloud.value;

            // Si tenemos cambios locales pendientes, merge para no perderlos
            if (keyFn && Array.isArray(cloud.value) && this.hasPendingChanges(collection)) {
              try {
                const localRaw = localStorage.getItem(storageKey);
                const localData = localRaw ? JSON.parse(localRaw) : null;
                if (Array.isArray(localData)) {
                  const deletions = this.localDeletions[collection];
                  finalData = this.mergeByKey(cloud.value as any[], localData, keyFn, deletions);
                }
              } catch { /* ignore parse errors */ }
            }

            localStorage.setItem(storageKey, JSON.stringify(finalData));
            this.setLocalUpdatedAt(collection, cloud.updatedAt);
            console.log(`[CloudSync] 🔄 Pull remoto: ${collection} (${cloud.updatedAt} > ${localUpdatedAt})`);
            changed = true;
          }
        } catch (e) {
          console.error(`[CloudSync] Error pull ${collection}:`, e);
        }
      }

      if (changed) this.notifyRemoteChange();
    } finally {
      this.pullInProgress = false;
    }
  }

  // ── Sync inicial ───────────────────────────────────────────────────────

  /**
   * Sync al conectar.
   *
   * Regla: comparar timestamps para decidir la dirección del sync.
   * - Si local es más reciente → local gana (subir a nube SIN merge aditivo,
   *   porque items ausentes en local = eliminaciones que aún no se subieron).
   * - Si nube es más reciente → nube gana (bajar a local; agregar items
   *   locales que no estén en nube solo si son adiciones offline genuinas).
   * - Para datos no-array (settings): el más reciente gana directamente.
   *
   * Usa getDocFromServer para evitar leer del caché de Firestore SDK.
   */
  private async initialSync(): Promise<void> {
    for (const collection of COLLECTIONS) {
      const storageKey = STORAGE_KEYS[collection];

      try {
        // Leer del SERVIDOR para evitar caché stale del SDK
        let cloud: { exists: boolean; value: unknown; updatedAt: number };
        try {
          cloud = await loadUserDataFromServer<unknown>(collection);
        } catch {
          // Offline: fallback a caché local del SDK
          cloud = await loadUserDataWithMeta<unknown>(collection);
        }
        const cloudData = cloud.value;
        const cloudUpdatedAt = cloud.updatedAt;
        const localRaw = localStorage.getItem(storageKey);
        const localData = localRaw ? JSON.parse(localRaw) : null;

        // Determinar si los datos locales son "reales" (no vacíos)
        const localHasRealData = Array.isArray(localData)
          ? localData.length > 0
          : localData !== null && localData !== undefined;

        // Determinar si los datos de la nube son "reales" (no vacíos)
        const cloudHasRealData = Array.isArray(cloudData)
          ? cloudData.length > 0
          : cloudData !== null && cloudData !== undefined;

        // Si no hay META registrado para esta colección pero el local tiene datos,
        // inicializar el META con el timestamp actual para que future syncs sean correctos.
        let localUpdatedAt = this.getLocalUpdatedAt(collection);
        if (localUpdatedAt === 0 && localHasRealData) {
          localUpdatedAt = Date.now();
          this.setLocalUpdatedAt(collection, localUpdatedAt);
        }

        if (!cloud.exists && !localData) {
          // Nada que sincronizar
        } else if (!cloud.exists && localData) {
          // Primera vez en este dispositivo: subir local a la nube
          await saveUserData(collection, localData, DEVICE_ID);
          this.setLocalUpdatedAt(collection, Date.now());
          console.log(`[CloudSync] ${collection}: subido a la nube (primera vez)`);
        } else if (cloud.exists && !localHasRealData && cloudHasRealData) {
          // La nube tiene datos reales pero el local está vacío/nulo → aplicar nube
          localStorage.setItem(storageKey, JSON.stringify(cloudData));
          this.setLocalUpdatedAt(collection, cloudUpdatedAt || Date.now());
          console.log(`[CloudSync] ${collection}: cargado de la nube (${cloudUpdatedAt})`);
        } else if (localHasRealData && !cloudHasRealData) {
          // El local tiene datos reales pero la nube está vacía → subir local
          await saveUserData(collection, localData, DEVICE_ID);
          this.setLocalUpdatedAt(collection, Date.now());
          console.log(`[CloudSync] ${collection}: local tiene datos, nube vacía → subiendo local`);
        } else {
          // Ambos lados tienen datos reales
          const keyFn = CloudSync.ARRAY_KEY_FN[collection];
          if (keyFn && Array.isArray(cloudData) && Array.isArray(localData)) {
            const localIsNewer = localUpdatedAt > cloudUpdatedAt;

            if (localIsNewer) {
              // Local es más reciente → local gana completamente.
              // Items en nube que no están en local = eliminaciones que no se subieron.
              // NO hacer merge aditivo (resucitaría bloques eliminados).
              localStorage.setItem(storageKey, JSON.stringify(localData));
              await saveUserData(collection, localData, DEVICE_ID);
              console.log(`[CloudSync] ${collection}: local más reciente → subido (${localData.length} items)`);
            } else {
              // Nube es más reciente → nube gana; agregar items locales nuevos
              const merged = this.mergeByKey(cloudData, localData, keyFn);
              localStorage.setItem(storageKey, JSON.stringify(merged));
              if (merged.length > cloudData.length) {
                await saveUserData(collection, merged, DEVICE_ID);
                console.log(`[CloudSync] ${collection}: nube primary + ${merged.length - cloudData.length} adiciones locales`);
              } else {
                console.log(`[CloudSync] ${collection}: nube al día (${cloudData.length} items)`);
              }
            }
            this.setLocalUpdatedAt(collection, Date.now());
          } else {
            // No-array (settings, etc.): elegir el más reciente
            if (localUpdatedAt > cloudUpdatedAt) {
              await saveUserData(collection, localData, DEVICE_ID);
              this.setLocalUpdatedAt(collection, Date.now());
              console.log(`[CloudSync] ${collection}: local más reciente (${localUpdatedAt} > ${cloudUpdatedAt})`);
            } else {
              localStorage.setItem(storageKey, JSON.stringify(cloudData));
              this.setLocalUpdatedAt(collection, cloudUpdatedAt || Date.now());
              console.log(`[CloudSync] ${collection}: nube más reciente (${cloudUpdatedAt} >= ${localUpdatedAt})`);
            }
          }
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
        (data: unknown, updatedAt: number, writerDeviceId?: string) => {
          // Ignorar escrituras propias
          if (writerDeviceId === DEVICE_ID) return;

          // Ignorar snapshots con timestamp igual o anterior al que ya tenemos
          // (evita que el snapshot inicial del cache sobrescriba datos frescos de initialSync)
          const localUpdatedAt = this.getLocalUpdatedAt(collection);
          if (updatedAt > 0 && updatedAt <= localUpdatedAt) return;

          if (data !== null && data !== undefined) {
            try {
              if (this.active) this.setStatus('syncing');

              let finalData = data;
              const keyFn = CloudSync.ARRAY_KEY_FN[collection];

              // Si tenemos cambios locales pendientes, merge para preservarlos
              if (keyFn && Array.isArray(data) && this.hasPendingChanges(collection)) {
                try {
                  const localRaw = localStorage.getItem(storageKey);
                  const localData = localRaw ? JSON.parse(localRaw) : null;
                  if (Array.isArray(localData)) {
                    const deletions = this.localDeletions[collection];
                    finalData = this.mergeByKey(data as any[], localData, keyFn, deletions);
                  }
                } catch { /* ignore */ }
              }

              localStorage.setItem(storageKey, JSON.stringify(finalData));
              this.setLocalUpdatedAt(collection, updatedAt || Date.now());
              console.log(`[CloudSync] 📥 Cambio remoto: ${collection}`);
              this.notifyRemoteChange();
              if (this.active) this.setStatus('connected');
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
