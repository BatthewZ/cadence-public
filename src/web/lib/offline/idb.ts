/**
 * The per-account IndexedDB that holds offline data: the write queue and the persisted query cache.
 *
 * iOS Safari refuses IndexedDB cursors (pwa-starter CONTRACT §7b), so only get / getAll / put /
 * add / delete / count / clear are used — never openCursor, openKeyCursor or index cursors.
 */

const DB_VERSION = 1;

export const OUTBOX_STORE = "outbox";
export const KV_STORE = "kv";

type StoreName = typeof OUTBOX_STORE | typeof KV_STORE;

/** One database per account, so two accounts on one browser never see each other's queue. */
export function offlineDbName(userId: string): string {
  return `cadence-offline:${userId}`;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export interface OfflineDb {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
  add(store: StoreName, value: unknown): Promise<IDBValidKey>;
  /** Adds every value in one transaction: all of them commit, or none. */
  addAll(store: StoreName, values: unknown[]): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  /**
   * Reads `key`, passes the value to `next` and stores what it returns, in one transaction: no other
   * tab's write can land in between. `next` must be synchronous (an await would end the transaction).
   */
  update<T>(store: StoreName, key: IDBValidKey, next: (current: T | undefined) => T): Promise<void>;
  count(store: StoreName): Promise<number>;
  close(): void;
}

export function openOfflineDb(userId: string): Promise<OfflineDb> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(offlineDbName(userId), DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage"));
    request.onblocked = () => reject(new Error("Offline storage is blocked by another tab"));
    request.onsuccess = () => {
      const db = request.result;
      // Another tab deleting this database (sign-out) must not be blocked by this connection.
      db.onversionchange = () => db.close();
      resolve(wrap(db));
    };
  });
}

function wrap(db: IDBDatabase): OfflineDb {
  const store = (name: StoreName, mode: IDBTransactionMode) =>
    db.transaction(name, mode).objectStore(name);

  const write = <T>(name: StoreName, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const tx = db.transaction(name, "readwrite");
      const request = run(tx.objectStore(name));
      // Resolve on commit, not on request success: a write isn't durable until the transaction is.
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
    });

  return {
    get: <T>(name: StoreName, key: IDBValidKey) =>
      promisify(store(name, "readonly").get(key)) as Promise<T | undefined>,
    getAll: <T>(name: StoreName) => promisify(store(name, "readonly").getAll()) as Promise<T[]>,
    put: (name, value, key) => write(name, (s) => (key === undefined ? s.put(value) : s.put(value, key))),
    add: (name, value) => write(name, (s) => s.add(value)),
    addAll: async (name, values) => {
      if (values.length === 0) return;
      await write(name, (s) => values.map((value) => s.add(value))[values.length - 1]);
    },
    delete: async (name, key) => {
      await write(name, (s) => s.delete(key));
    },
    update: <T>(name: StoreName, key: IDBValidKey, next: (current: T | undefined) => T) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(name, "readwrite");
        const objectStore = tx.objectStore(name);
        const read = objectStore.get(key);
        // A throw in `next` aborts the transaction, so a failed update leaves the old value in place.
        read.onsuccess = () => void objectStore.put(next(read.result as T | undefined), key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
      }),
    count: (name) => promisify(store(name, "readonly").count()),
    close: () => db.close(),
  };
}

export function deleteOfflineDb(userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(offlineDbName(userId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not delete offline storage"));
    // Resolves once the other tabs' connections close (their onversionchange does that).
    request.onblocked = () => undefined;
  });
}
