import type { Shop } from "./types"

/**
 * Persistent device storage. Shop list and bearer tokens live in IndexedDB, never in localStorage.
 * Order, customer and address data are never written here (memory only).
 */
export interface ShopStore {
  loadShops(): Promise<Shop[]>
  saveShops(shops: Shop[]): Promise<void>
  clear(): Promise<void>
}

const DB = "medusify"
const STORE = "kv"
const KEY = "shops"

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(req.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const idbStore: ShopStore = {
  async loadShops() {
    const value = await run<unknown>("readonly", (s) => s.get(KEY))
    return Array.isArray(value) ? (value as Shop[]) : []
  },
  async saveShops(shops) {
    await run("readwrite", (s) => s.put(shops, KEY))
  },
  async clear() {
    await run("readwrite", (s) => s.clear())
  },
}
