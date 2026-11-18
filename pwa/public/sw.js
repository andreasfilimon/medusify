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
  event.waitUntil(self.registration.showNotification(title, options))
})

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
