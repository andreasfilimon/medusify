import { expect, test } from "@playwright/test"
import { BASE } from "./helpers"

test("the service worker is registered for /medusify/ and caches only the offline page", async ({ page, context }) => {
  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).click()
  await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()

  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready
    return { scope: r.scope, script: r.active?.scriptURL }
  })
  expect(reg.scope).toBe(`${BASE}/medusify/`)
  expect(reg.script).toBe(`${BASE}/medusify/sw.js`)

  // Visit more pages, then look at everything the browser stored for the app.
  await page.goto("orders")
  await expect(page.getByRole("heading", { name: "Bestellungen" }).first()).toBeVisible()
  const stored = await page.evaluate(async () => {
    const out: string[] = []
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname)
    return out
  })
  expect(stored).toEqual(["/medusify/offline.html"])

  // Offline: a page request gets the offline page, not the browser error.
  await context.setOffline(true)
  await page.goto("orders").catch(() => undefined)
  await expect(page.getByRole("heading", { name: /Keine Verbindung|Offline/i })).toBeVisible()
  await context.setOffline(false)
})
