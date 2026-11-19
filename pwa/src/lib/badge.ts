/**
 * The number on the app icon: orders to ship, summed over all shops.
 *
 * The app knows every shop's number while it is open. A push arrives for one shop only, and carries that shop's number;
 * the service worker needs the others from somewhere, so the per-shop numbers live in a small IndexedDB of their own
 * ("medusify-badge"), which `public/sw.js` reads and writes with the same layout. A push names its shop by the label the
 * plugin puts in titles (`shop_label` of the dashboard), so an entry carries that label next to the number.
 */
export type BadgeEntry = { label: string; n: number }
export type BadgeCounts = Record<string, BadgeEntry>

const DB = "medusify-badge"
const STORE = "counts"
const KEY = "all"

export const badgeTotal = (counts: BadgeCounts): number => Object.values(counts).reduce((sum, e) => sum + (Number.isFinite(e.n) && e.n > 0 ? Math.floor(e.n) : 0), 0)

/**
 * The stored numbers after the app has read some shops: fresh numbers replace old ones, a shop that did not answer keeps
 * its last number, and shops that are gone (or were only known from a push) drop out.
 */
export function mergeCounts(prev: BadgeCounts, fresh: { id: string; label: string; n: number }[], knownIds: string[]): BadgeCounts {
  const next: BadgeCounts = {}
  for (const id of knownIds) {
    const hit = fresh.find((f) => f.id === id)
    if (hit) next[id] = { label: hit.label, n: hit.n }
    else if (prev[id]) next[id] = prev[id]
  }
  return next
}

/** Setting the badge needs the Badging API; where it is missing (desktop Firefox, old iOS) nothing happens. */
export function badgeSupported(nav: object = navigator): boolean {
  return typeof (nav as { setAppBadge?: unknown }).setAppBadge === "function"
}

export async function setBadge(n: number, nav: object = navigator): Promise<void> {
  if (!badgeSupported(nav)) return
  const target = nav as { setAppBadge(n?: number): Promise<void>; clearAppBadge?(): Promise<void> }
  try {
    if (n > 0) await target.setAppBadge(n)
    else if (target.clearAppBadge) await target.clearAppBadge()
    else await target.setAppBadge(0)
  } catch {
    // A refused badge is not worth an error: it is a convenience on the icon.
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function readCounts(): Promise<BadgeCounts> {
  const db = await open()
  try {
    return await new Promise<BadgeCounts>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as BadgeCounts | undefined) ?? {})
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Read, change and write in one transaction, so two pushes in a row cannot overwrite each other. */
export async function updateCounts(change: (prev: BadgeCounts) => BadgeCounts): Promise<BadgeCounts> {
  const db = await open()
  try {
    return await new Promise<BadgeCounts>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite")
      const store = tx.objectStore(STORE)
      let next: BadgeCounts = {}
      const get = store.get(KEY)
      get.onsuccess = () => {
        next = change((get.result as BadgeCounts | undefined) ?? {})
        store.put(next, KEY)
      }
      tx.oncomplete = () => resolve(next)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** Called with what the app just read from its shops: stores the numbers and puts the sum on the icon. */
export async function syncBadge(fresh: { id: string; label: string; n: number }[], knownIds: string[], nav: object = navigator): Promise<number> {
  const next = await updateCounts((prev) => mergeCounts(prev, fresh, knownIds))
  const total = badgeTotal(next)
  await setBadge(total, nav)
  return total
}

export async function clearBadge(nav: object = navigator): Promise<void> {
  try {
    await updateCounts(() => ({}))
  } catch {
    // no storage, nothing stored
  }
  await setBadge(0, nav)
}
