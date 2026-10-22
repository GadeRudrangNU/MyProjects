import type { UploadItem, UploadStore } from "./types";

const DB = "bytedrop-uploads";
const STORE = "items";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

/** Persists queue entries (including the File itself) so an interrupted upload can continue after a refresh. */
export const idbStore: UploadStore = {
  async loadAll() {
    try {
      const rows = await run("readonly", (s) => s.getAll() as IDBRequest<(UploadItem & { file: Blob })[]>);
      return rows.map(({ file, ...item }) => ({ item: item as UploadItem, file }));
    } catch {
      return [];
    }
  },
  async save(item, file) {
    try {
      await run("readwrite", (s) => s.put({ ...item, file }));
    } catch {
      /* storage unavailable (private mode or quota): the queue keeps working in memory */
    }
  },
  async remove(id) {
    try {
      await run("readwrite", (s) => s.delete(id));
    } catch {
      /* ignore */
    }
  },
};

export const memoryStore = (): UploadStore => {
  const rows = new Map<string, { item: UploadItem; file: Blob }>();
  return {
    async loadAll() {
      return [...rows.values()];
    },
    async save(item, file) {
      rows.set(item.id, { item: { ...item }, file });
    },
    async remove(id) {
      rows.delete(id);
    },
  };
};
