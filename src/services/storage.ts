/**
 * Local persistence.
 *
 * - `KeyValueStore` (IndexedDB, memory fallback) holds bulky data such as
 *   cached TLE text. IndexedDB is asynchronous and has no practical size limit
 *   for this use, unlike localStorage (~5 MB, synchronous).
 * - `safeLocalStorage()` backs small Zustand `persist` slices (observer,
 *   settings, selections). It falls back to memory when localStorage is
 *   unavailable (private mode, tests), so persistence never crashes the app.
 */

export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      map.set(key, value);
    },
    async delete(key: string) {
      map.delete(key);
    },
  };
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** IndexedDB-backed store with a single object store. The database opens lazily. */
export function createIndexedDbStore(dbName = 'sattrack', storeName = 'kv'): KeyValueStore {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = () => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open IndexedDB'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
    });
    return dbPromise;
  };
  const withStore = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    return requestToPromise(fn(db.transaction(storeName, mode).objectStore(storeName)));
  };
  return {
    async get<T>(key: string) {
      return (await withStore('readonly', (s) => s.get(key))) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      await withStore('readwrite', (s) => s.put(value, key));
    },
    async delete(key: string) {
      await withStore('readwrite', (s) => s.delete(key));
    },
  };
}

/**
 * Wraps a store so that any failure degrades to an in-memory store for the
 * rest of the session instead of breaking catalog loading.
 */
export function withMemoryFallback(primary: KeyValueStore, onFallback?: (err: unknown) => void): KeyValueStore {
  const memory = createMemoryStore();
  let active = primary;
  const guard = async <T>(op: (s: KeyValueStore) => Promise<T>): Promise<T> => {
    try {
      return await op(active);
    } catch (err) {
      if (active === memory) throw err;
      onFallback?.(err);
      active = memory;
      return op(active);
    }
  };
  return {
    get: (key) => guard((s) => s.get(key)),
    set: (key, value) => guard((s) => s.set(key, value)),
    delete: (key) => guard((s) => s.delete(key)),
  };
}

/**
 * Which backends persistence actually ended up on. `memory` means data lasts
 * only for this page session; the UI tells the user (see NoticeBar).
 */
export interface StorageStatus {
  cache: 'indexeddb' | 'memory';
  preferences: 'localStorage' | 'memory';
}

const storageStatus: StorageStatus = { cache: 'indexeddb', preferences: 'localStorage' };
const storageListeners = new Set<() => void>();
let storageSnapshot: StorageStatus = { ...storageStatus };

function setStorageStatus(patch: Partial<StorageStatus>): void {
  Object.assign(storageStatus, patch);
  storageSnapshot = { ...storageStatus };
  storageListeners.forEach((l) => l());
}

/** Current storage backends. Stable object until a fallback happens. */
export function getStorageStatus(): StorageStatus {
  return storageSnapshot;
}

/** Subscribe to storage fallbacks (for `useSyncExternalStore`). */
export function subscribeStorageStatus(listener: () => void): () => void {
  storageListeners.add(listener);
  return () => storageListeners.delete(listener);
}

let defaultCache: KeyValueStore | null = null;

/** The app-wide cache store: IndexedDB when available, otherwise memory. */
export function getDefaultCacheStore(): KeyValueStore {
  if (!defaultCache) {
    if (typeof indexedDB === 'undefined') {
      setStorageStatus({ cache: 'memory' });
      defaultCache = createMemoryStore();
    } else {
      defaultCache = withMemoryFallback(createIndexedDbStore(), (err) => {
        console.warn('[storage] IndexedDB unavailable, caching in memory for this session', err);
        setStorageStatus({ cache: 'memory' });
      });
    }
  }
  return defaultCache;
}

/** Minimal synchronous storage interface compatible with Zustand's `createJSONStorage`. */
export interface SyncStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoryStorage(): SyncStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

let syncStorage: SyncStorage | null = null;

/** localStorage when usable, otherwise an in-memory substitute. */
export function safeLocalStorage(): SyncStorage {
  if (syncStorage) return syncStorage;
  try {
    const ls = globalThis.localStorage;
    const probe = '__sattrack_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    syncStorage = ls;
  } catch (err) {
    console.warn('[storage] localStorage unavailable, preferences last only for this session', err);
    syncStorage = memoryStorage();
    setStorageStatus({ preferences: 'memory' });
  }
  return syncStorage;
}

/** Keys used by persisted Zustand stores, kept in one place to avoid collisions. */
export const PERSIST_KEYS = {
  satellites: 'sattrack.satellites.v1',
  observer: 'sattrack.observer.v1',
  settings: 'sattrack.settings.v1',
} as const;
