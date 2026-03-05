/**
 * Cloud Sync v2 — Sincronización bidireccional localStorage ↔ Firebase Firestore.
 *
 * Mejoras respecto a v1:
 *  1. Versionado por item: cada item tiene `_v` (timestamp de última modificación).
 *     El merge compara versiones item-a-item, no colección completa.
 *  2. Tombstones persistentes: las eliminaciones se guardan en localStorage
 *     para sobrevivir recargas de página.
 *  3. Device ID estable: persistido en localStorage, no cambia entre recargas.
 *  4. onSnapshot como canal principal: sin polling redundante cada 3s.
 *     Solo se hace un pull del servidor cuando la pestaña vuelve a ser visible
 *     o la red se reconecta (para cubrir snapshots perdidos).
 *  5. Upload directo: sin read-before-write. El merge se hace al recibir
 *     cambios remotos, no al subir.
 *  6. Merge inteligente: para cada item, gana el que tenga `_v` mayor.
 *     Items eliminados (tombstones) se respetan.
 *
 * Arquitectura:
 *  - localStorage = cache rápido, funciona offline.
 *  - Firestore = fuente de verdad compartida entre dispositivos.
 *  - Cada escritura local se sube a Firestore (debounced 800ms).
 *  - onSnapshot escucha cambios remotos y los baja con merge inteligente.
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

const TOMBSTONE_KEY = 'focusos_sync_tombstones';
const DEVICE_ID_KEY = 'focusos_device_id';
const META_KEY = 'focusos_sync_meta';

const DEBOUNCE_MS = 800;
// Tombstones expiran después de 7 días (limpieza)
const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CloudSyncStatus = 'disconnected' | 'connecting' | 'retrying' | 'syncing' | 'connected';

// ─── Device ID estable ──────────────────────────────────────────────────────

function getStableDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `fallback-${Date.now()}`;
  }
}

const DEVICE_ID = getStableDeviceId();

// ─── Tombstones persistentes ────────────────────────────────────────────────

interface TombstoneEntry {
  /** ID del item eliminado */
  id: string;
  /** Timestamp de eliminación */
  deletedAt: number;
}

type TombstoneStore = Partial<Record<Collection, TombstoneEntry[]>>;

function loadTombstones(): TombstoneStore {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTombstones(store: TombstoneStore): void {
  try {
    localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(store));
  } catch { /* ignore */ }
}

function addTombstone(collection: Collection, id: string): void {
  const store = loadTombstones();
  if (!store[collection]) store[collection] = [];
  // No duplicar
  if (!store[collection]!.some(t => t.id === id)) {
    store[collection]!.push({ id, deletedAt: Date.now() });
  }
  saveTombstones(store);
}

function addTombstones(collection: Collection, ids: string[]): void {
  const store = loadTombstones();
  if (!store[collection]) store[collection] = [];
  const existing = new Set(store[collection]!.map(t => t.id));
  const now = Date.now();
  for (const id of ids) {
    if (!existing.has(id)) {
      store[collection]!.push({ id, deletedAt: now });
      existing.add(id);
    }
  }
  saveTombstones(store);
}

function getTombstoneIds(collection: Collection): Set<string> {
  const store = loadTombstones();
  const entries = store[collection] ?? [];
  return new Set(entries.map(e => e.id));
}

/** Limpia tombstones expirados (> 7 días) */
function cleanExpiredTombstones(): void {
  const store = loadTombstones();
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  let changed = false;
  for (const col of COLLECTIONS) {
    const entries = store[col];
    if (!entries) continue;
    const filtered = entries.filter(e => e.deletedAt > cutoff);
    if (filtered.length !== entries.length) {
      store[col] = filtered;
      changed = true;
    }
  }
  if (changed) saveTombstones(store);
}

// ─── Item versioning helpers ────────────────────────────────────────────────

/** Agrega `_v` (version timestamp) a un item si no lo tiene */
function ensureVersion<T extends Record<string, unknown>>(item: T): T & { _v: number } {
  if (typeof (item as any)._v === 'number') return item as T & { _v: number };
  return { ...item, _v: Date.now() };
}

/** Agrega `_v` a todos los items de un array */
function ensureVersionAll<T extends Record<string, unknown>>(items: T[]): Array<T & { _v: number }> {
  return items.map(ensureVersion);
}

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
  /** Track the last updatedAt we've seen from the server per collection */
  private lastSeenRemoteTs: Partial<Record<Collection, number>> = {};
  /** Whether initial sync is still running (suppress listener writes during) */
  private initialSyncRunning = false;
  /** Whether an upload is in flight per collection */
  private uploadInFlight: Partial<Record<string, boolean>> = {};

  /** Funciones clave para cada colección que es un array mergeable */
  private static readonly ARRAY_KEY_FN: Record<string, (item: any) => string> = {
    tasks: (item) => item.id,
    blocks: (item) => item.id,
    metrics: (item) => item.date,
  };

  constructor() {
    this.loadMeta();
    this.installLifecycleHandlers();
    cleanExpiredTombstones();
  }

  // ── Versionado + Merge inteligente ──────────────────────────────────────

  /**
   * Merge inteligente por item.
   * Para cada item, gana el que tenga `_v` mayor.
   * Items en tombstones se excluyen del resultado final.
   */
  private mergeByVersion(
    local: unknown[],
    remote: unknown[],
    keyFn: (item: any) => string,
    tombstones: Set<string>,
  ): unknown[] {
    const localMap = new Map<string, any>();
    for (const item of local) {
      const versioned = ensureVersion(item as Record<string, unknown>);
      localMap.set(keyFn(versioned), versioned);
    }

    const remoteMap = new Map<string, any>();
    for (const item of remote) {
      const versioned = ensureVersion(item as Record<string, unknown>);
      remoteMap.set(keyFn(versioned), versioned);
    }

    // Unión de todas las keys
    const allKeys = new Set([...localMap.keys(), ...remoteMap.keys()]);
    const result: unknown[] = [];

    for (const key of allKeys) {
      // Excluir items en tombstones
      if (tombstones.has(key)) continue;

      const localItem = localMap.get(key);
      const remoteItem = remoteMap.get(key);

      if (localItem && !remoteItem) {
        result.push(localItem);
      } else if (!localItem && remoteItem) {
        result.push(remoteItem);
      } else if (localItem && remoteItem) {
        // Ambos existen: gana el de mayor `_v`
        const lv = typeof localItem._v === 'number' ? localItem._v : 0;
        const rv = typeof remoteItem._v === 'number' ? remoteItem._v : 0;
        result.push(lv >= rv ? localItem : remoteItem);
      }
    }

    return result;
  }

  // ── Tombstone API pública (llamada desde store.ts) ──────────────────────

  /** Registra una eliminación local persistente */
  trackDeletion(collection: string, id: string): void {
    if ((COLLECTIONS as readonly string[]).includes(collection)) {
      addTombstone(collection as Collection, id);
    }
  }

  /** Registra múltiples eliminaciones locales */
  trackDeletions(collection: string, ids: string[]): void {
    if ((COLLECTIONS as readonly string[]).includes(collection)) {
      addTombstones(collection as Collection, ids);
    }
  }

  // ── Meta timestamps ────────────────────────────────────────────────────

  private loadMeta(): void {
    try {
      const raw = localStorage.getItem(META_KEY);
      if (raw) {
        this.lastSeenRemoteTs = JSON.parse(raw);
      }
    } catch { /* ignore */ }
  }

  private saveMeta(): void {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(this.lastSeenRemoteTs));
    } catch { /* ignore */ }
  }

  private getLocalUpdatedAt(collection: Collection): number {
    return this.lastSeenRemoteTs[collection] ?? 0;
  }

  private setLocalUpdatedAt(collection: Collection, ts: number): void {
    this.lastSeenRemoteTs[collection] = ts;
    this.saveMeta();
  }

  // ── Lifecycle: visibilitychange + online ─────────────────────────────────

  private installLifecycleHandlers(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (this.active) {
          // Flush uploads que pudieron quedar atascados
          this.flushPending();
          // Pull una vez del servidor para cubrir snapshots perdidos en background
          this.reconcileFromServer();
        } else if (!this.connecting) {
          this.connect();
        }
      }
    });

    window.addEventListener('online', () => {
      if (!this.active && !this.connecting) {
        this.connect();
      } else if (this.active) {
        this.flushPending();
        this.reconcileFromServer();
      }
    });
  }

  // ── Wait for Firebase session ──────────────────────────────────────────

  private async waitForRestoredFirebaseSession(timeoutMs = 2500): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (getFirebaseUser() || auth.currentUser) return true;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return !!(getFirebaseUser() || auth.currentUser);
  }

  // ── Pub/Sub ─────────────────────────────────────────────────────────────

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
    for (const fn of this.statusCallbacks) {
      try { fn(next); } catch (e) { console.error('[CloudSync] status callback error:', e); }
    }
  }

  onRemoteChange(fn: () => void): () => void {
    this.changeCallbacks.push(fn);
    return () => {
      this.changeCallbacks = this.changeCallbacks.filter(cb => cb !== fn);
    };
  }

  private notifyRemoteChange(): void {
    for (const fn of this.changeCallbacks) {
      try { fn(); } catch (e) { console.error('[CloudSync] callback error:', e); }
    }
  }

  // ── Conexión ────────────────────────────────────────────────────────────

  async connect(): Promise<boolean> {
    if (this.active) return true;
    if (this.connecting) return false;
    this.connecting = true;
    this.setStatus('connecting');

    // Descartar uploads pre-connection (datos del constructor del Store,
    // posiblemente obsoletos — initialSync decidirá qué es correcto)
    for (const timer of Object.values(this.debounceTimers)) clearTimeout(timer);
    this.debounceTimers = {};
    this.pendingUploads = {};

    try {
      // 1) Preferir sesión Firebase ya restaurada
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

      // Escuchar cambios en tiempo real (canal principal)
      this.startListening();

      this.active = true;
      this.connecting = false;
      this.setStatus('connected');

      // Subir uploads acumulados offline
      this.flushPending();

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
   * Encola datos para subir a Firestore (debounced).
   * Upload directo sin read-before-write.
   */
  uploadDebounced(collection: string, data: unknown): void {
    this.pendingUploads[collection] = data;

    if (this.active) this.setStatus('syncing');

    if (this.debounceTimers[collection]) {
      clearTimeout(this.debounceTimers[collection]);
    }

    this.debounceTimers[collection] = setTimeout(async () => {
      delete this.debounceTimers[collection];
      if (!this.active) return; // se subirá en flushPending al conectar
      await this.doUpload(collection);
    }, DEBOUNCE_MS);
  }

  /**
   * Upload directo a Firestore. Sin read-before-write.
   * El merge se hace al RECIBIR datos remotos, no al enviar.
   */
  private async doUpload(collection: string): Promise<boolean> {
    const data = this.pendingUploads[collection];
    if (data === undefined) return true;

    // Prevenir uploads concurrentes para la misma colección
    if (this.uploadInFlight[collection]) return false;
    this.uploadInFlight[collection] = true;

    try {
      if (this.active) this.setStatus('syncing');

      // Asegurar versioning en items
      let dataToUpload = data;
      const keyFn = CloudSync.ARRAY_KEY_FN[collection];
      if (keyFn && Array.isArray(data)) {
        dataToUpload = ensureVersionAll(data as Record<string, unknown>[]);
      }

      // saveUserData retorna el timestamp EXACTO que usó — usar ese mismo
      // para meta, en vez de Date.now() (evita drift entre dispositivos)
      const ts = await saveUserData(collection, dataToUpload, DEVICE_ID);

      // Solo limpiar si no cambió mientras se subía
      if (this.pendingUploads[collection] === data) {
        delete this.pendingUploads[collection];
      }

      // Usar el timestamp exacto de Firestore para meta
      if (ts > 0 && (COLLECTIONS as readonly string[]).includes(collection)) {
        this.setLocalUpdatedAt(collection as Collection, ts);
      }

      if (this.active) this.setStatus('connected');
      return true;
    } catch (e) {
      console.error(`[CloudSync] Error subiendo ${collection}:`, e);
      if (this.active) this.setStatus('connected');
      return false;
    } finally {
      this.uploadInFlight[collection] = false;
      // Si llegaron datos nuevos mientras se subía, reintentar
      if (this.pendingUploads[collection] !== undefined && this.active && !this.debounceTimers[collection]) {
        this.debounceTimers[collection] = setTimeout(() => {
          delete this.debounceTimers[collection];
          if (this.active) this.doUpload(collection);
        }, DEBOUNCE_MS);
      }
    }
  }

  /** Sube inmediatamente sin debounce (para datos críticos) */
  uploadImmediate(collection: string, data: unknown): void {
    // Cancelar debounce pendiente
    if (this.debounceTimers[collection]) {
      clearTimeout(this.debounceTimers[collection]);
      delete this.debounceTimers[collection];
    }
    this.pendingUploads[collection] = data;
    if (this.active) {
      this.doUpload(collection);
    }
  }

  /** Sube todos los uploads pendientes */
  private async flushPending(): Promise<void> {
    const collections = Object.keys(this.pendingUploads);
    if (collections.length === 0) return;
    if (this.active) this.setStatus('syncing');
    for (const collection of collections) {
      await this.doUpload(collection);
    }
    if (this.active) this.setStatus('connected');
  }

  // ── Sync inicial ───────────────────────────────────────────────────────

  /**
   * Sync al conectar: para cada colección, merge inteligente local ↔ nube.
   * Usa getDocFromServer para evitar caché stale del SDK.
   */
  private async initialSync(): Promise<void> {
    this.initialSyncRunning = true;

    try {
      for (const collection of COLLECTIONS) {
        await this.syncCollection(collection);
      }
      this.notifyRemoteChange();
    } finally {
      this.initialSyncRunning = false;
    }
  }

  /** Sync una colección individual */
  private async syncCollection(collection: Collection): Promise<void> {
    const storageKey = STORAGE_KEYS[collection];

    try {
      // Leer del SERVIDOR
      let cloud: { exists: boolean; value: unknown; updatedAt: number };
      try {
        cloud = await loadUserDataFromServer<unknown>(collection);
      } catch {
        // Offline: fallback a caché
        cloud = await loadUserDataWithMeta<unknown>(collection);
      }

      const localRaw = localStorage.getItem(storageKey);
      const localData = localRaw ? JSON.parse(localRaw) : null;

      const localHasData = Array.isArray(localData) ? localData.length > 0 : (localData != null);
      const cloudHasData = cloud.exists && (
        Array.isArray(cloud.value) ? (cloud.value as unknown[]).length > 0 : (cloud.value != null)
      );

      if (!cloudHasData && !localHasData) {
        // Nada que sincronizar
        return;
      }

      if (!cloudHasData && localHasData) {
        // Solo local tiene datos → subir
        let dataToUpload = localData;
        const keyFn = CloudSync.ARRAY_KEY_FN[collection];
        if (keyFn && Array.isArray(localData)) {
          dataToUpload = ensureVersionAll(localData);
          localStorage.setItem(storageKey, JSON.stringify(dataToUpload));
        }
        const ts = await saveUserData(collection, dataToUpload, DEVICE_ID);
        this.setLocalUpdatedAt(collection, ts || Date.now());
        console.log(`[CloudSync] ${collection}: subido a la nube (primera vez)`);
        return;
      }

      if (cloudHasData && !localHasData) {
        // Solo nube tiene datos → aplicar
        localStorage.setItem(storageKey, JSON.stringify(cloud.value));
        this.setLocalUpdatedAt(collection, cloud.updatedAt || Date.now());
        console.log(`[CloudSync] ${collection}: cargado de la nube`);
        return;
      }

      // Ambos tienen datos → merge inteligente
      const keyFn = CloudSync.ARRAY_KEY_FN[collection];
      if (keyFn && Array.isArray(cloud.value) && Array.isArray(localData)) {
        const tombstones = getTombstoneIds(collection);
        const merged = this.mergeByVersion(localData, cloud.value as unknown[], keyFn, tombstones);

        localStorage.setItem(storageKey, JSON.stringify(merged));

        // Determinar si hay diferencias vs la nube para decidir si subir
        const cloudKeys = new Set((cloud.value as any[]).map(keyFn));
        const mergedKeys = new Set((merged as any[]).map(keyFn));
        const needsUpload = merged.length !== (cloud.value as unknown[]).length
          || [...mergedKeys].some(k => !cloudKeys.has(k))
          || [...cloudKeys].some(k => !mergedKeys.has(k))
          || this.hasNewerLocalItems(localData, cloud.value as unknown[], keyFn);

        if (needsUpload) {
          const ts = await saveUserData(collection, merged, DEVICE_ID);
          this.setLocalUpdatedAt(collection, ts || cloud.updatedAt || Date.now());
          console.log(`[CloudSync] ${collection}: merge + upload (${merged.length} items)`);
        } else {
          this.setLocalUpdatedAt(collection, cloud.updatedAt || Date.now());
          console.log(`[CloudSync] ${collection}: merge (${merged.length} items, nube al día)`);
        }
      } else {
        // No-array (settings): el más reciente gana
        const localUpdatedAt = this.getLocalUpdatedAt(collection);
        if (localUpdatedAt > cloud.updatedAt) {
          const ts = await saveUserData(collection, localData, DEVICE_ID);
          this.setLocalUpdatedAt(collection, ts || Date.now());
          console.log(`[CloudSync] ${collection}: local más reciente`);
        } else {
          localStorage.setItem(storageKey, JSON.stringify(cloud.value));
          this.setLocalUpdatedAt(collection, cloud.updatedAt || Date.now());
          console.log(`[CloudSync] ${collection}: nube más reciente`);
        }
      }
    } catch (e) {
      console.error(`[CloudSync] Error sync ${collection}:`, e);
    }
  }

  /** Verifica si algún item local es más nuevo que su contraparte remota */
  private hasNewerLocalItems(local: unknown[], remote: unknown[], keyFn: (item: any) => string): boolean {
    const remoteMap = new Map<string, number>();
    for (const item of remote) {
      remoteMap.set(keyFn(item), (item as any)._v ?? 0);
    }
    for (const item of local) {
      const key = keyFn(item);
      const localV = (item as any)._v ?? 0;
      const remoteV = remoteMap.get(key) ?? -1;
      if (remoteV >= 0 && localV > remoteV) return true;
    }
    return false;
  }

  // ── Reconciliación desde servidor (reemplaza el polling) ────────────────

  /**
   * Se ejecuta cuando la pestaña vuelve a ser visible o la red se reconecta.
   * Lee del servidor (no caché) y aplica merge inteligente.
   * Reemplaza el polling cada 3s: más eficiente, solo cuando es necesario.
   */
  private async reconcileFromServer(): Promise<void> {
    if (!this.active) return;
    let changed = false;

    try {
      for (const collection of COLLECTIONS) {
        try {
          const cloud = await loadUserDataFromServer<unknown>(collection);
          if (!cloud.exists || cloud.value == null) continue;

          // ¿Es más nuevo que lo que ya vimos?
          const lastSeen = this.getLocalUpdatedAt(collection);
          if (cloud.updatedAt <= lastSeen) continue;

          const storageKey = STORAGE_KEYS[collection];
          const keyFn = CloudSync.ARRAY_KEY_FN[collection];

          if (keyFn && Array.isArray(cloud.value)) {
            // Merge inteligente con datos locales
            const localRaw = localStorage.getItem(storageKey);
            const localData = localRaw ? JSON.parse(localRaw) : [];
            const tombstones = getTombstoneIds(collection);
            const merged = this.mergeByVersion(
              Array.isArray(localData) ? localData : [],
              cloud.value as unknown[],
              keyFn,
              tombstones,
            );
            localStorage.setItem(storageKey, JSON.stringify(merged));
          } else {
            // Non-array: nube gana si es más reciente
            localStorage.setItem(storageKey, JSON.stringify(cloud.value));
          }

          this.setLocalUpdatedAt(collection, cloud.updatedAt);
          console.log(`[CloudSync] 🔄 Reconciliación: ${collection}`);
          changed = true;
        } catch (e) {
          console.error(`[CloudSync] Error reconcile ${collection}:`, e);
        }
      }

      if (changed) this.notifyRemoteChange();
    } catch (e) {
      console.error('[CloudSync] Error reconciliación:', e);
    }
  }

  // ── Escucha en tiempo real (canal principal) ────────────────────────────

  private startListening(): void {
    this.stopListening();

    for (const collection of COLLECTIONS) {
      const storageKey = STORAGE_KEYS[collection];

      const unsub = onUserDataChange(
        collection,
        (data: unknown, updatedAt: number, writerDeviceId?: string, fromCache?: boolean) => {
          // No procesar durante initialSync
          if (this.initialSyncRunning) return;

          // Ignorar snapshots del caché local (no son cambios remotos reales)
          if (fromCache) return;

          // Ignorar escrituras propias (doUpload ya actualiza meta)
          if (writerDeviceId === DEVICE_ID) return;

          if (data == null) return;

          try {
            if (this.active) this.setStatus('syncing');

            const keyFn = CloudSync.ARRAY_KEY_FN[collection];

            if (keyFn && Array.isArray(data)) {
              // Merge inteligente: combinar remoto con local, respetando versiones
              const localRaw = localStorage.getItem(storageKey);
              const localData = localRaw ? JSON.parse(localRaw) : [];
              const tombstones = getTombstoneIds(collection);
              const merged = this.mergeByVersion(
                Array.isArray(localData) ? localData : [],
                data as unknown[],
                keyFn,
                tombstones,
              );
              localStorage.setItem(storageKey, JSON.stringify(merged));
            } else {
              // Non-array (settings): remoto gana si es más reciente
              localStorage.setItem(storageKey, JSON.stringify(data));
            }

            this.setLocalUpdatedAt(collection, updatedAt || Date.now());
            console.log(`[CloudSync] 📥 Cambio remoto: ${collection}`);
            this.notifyRemoteChange();
            if (this.active) this.setStatus('connected');
          } catch (e) {
            console.error(`[CloudSync] Error aplicando ${collection}:`, e);
          }
        },
      );

      this.unsubscribers.push(unsub);
    }
  }

  private stopListening(): void {
    for (const fn of this.unsubscribers) fn();
    this.unsubscribers = [];
  }

  // ── Estado ──────────────────────────────────────────────────────────────

  isActive(): boolean {
    return this.active;
  }
}

export const cloudSync = new CloudSync();
