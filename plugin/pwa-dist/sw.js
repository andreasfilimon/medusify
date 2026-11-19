/* Medusify service worker.
 * Caches exactly one file: the offline page. Pages, API answers, images and customer data are never cached.
 * Handles push messages and opens the order on tap. */
const OFFLINE = "/medusify/offline.html"
const CACHE = "medusify-offline-v1"

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// Only page loads fall back to the offline page. Everything else goes to the network untouched.
self.addEventListener("fetch", (event) => {
  const request = event.request
  if (request.mode !== "navigate") return
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE).then((hit) => hit || Response.error())))
})

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  // iOS revokes the subscription after a silent push, so every push shows a notification.
  const title = typeof data.title === "string" && data.title ? data.title : "Medusify"
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    data: { url: typeof data.data?.url === "string" ? data.data.url : "/medusify/" },
  }
  const label = typeof data.data?.shop === "string" ? data.data.shop : ""
  const badge = data.data?.badge
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      // The icon number never costs the notification: any failure in here is swallowed.
      typeof badge === "number" ? updateBadge(label, badge).catch(() => {}) : Promise.resolve(),
    ]),
  )
})

/* The number on the app icon. The push carries the orders to ship of ONE shop; the other shops' numbers are in the
 * IndexedDB "medusify-badge" that the app writes (src/lib/badge.ts, same layout: one record "all" = { shopId: { label, n } }).
 * A push names its shop by label. One entry with that label gets the new number; two entries with the same label cannot
 * be told apart, so the icon stays as it is until the app corrects it on the next open. */
function badgeStore(mode, work) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("medusify-badge", 1)
    open.onupgradeneeded = () => open.result.createObjectStore("counts")
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction("counts", mode)
      const store = tx.objectStore("counts")
      let out
      work(store, (value) => (out = value))
      tx.oncomplete = () => (db.close(), resolve(out))
      tx.onerror = tx.onabort = () => (db.close(), reject(tx.error))
    }
  })
}

async function updateBadge(label, n) {
  if (typeof self.navigator?.setAppBadge !== "function" || !Number.isFinite(n) || n < 0) return
  const next = await badgeStore("readwrite", (store, done) => {
    const get = store.get("all")
    get.onsuccess = () => {
      const counts = get.result || {}
      const ids = Object.keys(counts).filter((id) => counts[id].label === label)
      if (ids.length === 1) counts[ids[0]] = { label, n: Math.floor(n) }
      else if (ids.length === 0) counts["push:" + label] = { label, n: Math.floor(n) }
      store.put(counts, "all")
      done(counts)
    }
  })
  const total = Object.values(next).reduce((sum, e) => sum + (e.n > 0 ? e.n : 0), 0)
  if (total > 0) await self.navigator.setAppBadge(total)
  else if (typeof self.navigator.clearAppBadge === "function") await self.navigator.clearAppBadge()
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || "/medusify/", self.location.origin)
  // Never leave the app's own scope.
  const url = target.origin === self.location.origin && target.pathname.startsWith("/medusify/") ? target.href : self.location.origin + "/medusify/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      const existing = list.find((c) => c.url.startsWith(self.location.origin + "/medusify/"))
      if (existing) {
        await existing.focus()
        if ("navigate" in existing) return existing.navigate(url)
        return undefined
      }
      return self.clients.openWindow(url)
    }),
  )
})
