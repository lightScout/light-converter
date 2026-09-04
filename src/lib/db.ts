/** Minimal IndexedDB key-value store. Blobs are stored as-is (structured clone), no base64. */
const NAME = 'light-converter', STORE = 'batches', VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}

export const db = {
  get: <T>(id: string) => tx<T | undefined>('readonly', s => s.get(id) as IDBRequest<T | undefined>),
  all: <T>() => tx<T[]>('readonly', s => s.getAll() as IDBRequest<T[]>),
  put: <T extends { id: string }>(v: T) => tx<IDBValidKey>('readwrite', s => s.put(v)),
  del: (id: string) => tx<undefined>('readwrite', s => s.delete(id)),
};

/** Stable object URLs for blobs (revoked never; page lifetime is short). */
const urls = new WeakMap<Blob, string>();
export function urlFor(blob: Blob | undefined): string {
  if (!blob) return '';
  let u = urls.get(blob);
  if (!u) { u = URL.createObjectURL(blob); urls.set(blob, u); }
  return u;
}
