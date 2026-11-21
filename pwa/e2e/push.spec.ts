import { execFileSync } from "node:child_process"
import { expect, test } from "@playwright/test"
import { BASE, adminToken } from "./helpers"

// The dev shop's database container and name; override when yours differ (the container tool too: E2E_CONTAINER_TOOL=docker).
const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? "medusify-pg"
const PG_DB = process.env.E2E_PG_DB ?? "medusify_devshop"
const rows = () =>
  Number(
    execFileSync(process.env.E2E_CONTAINER_TOOL ?? "podman", ["exec", PG_CONTAINER, "psql", "-U", "postgres", "-d", PG_DB, "-Atc", "select count(*) from medusify_push_subscription where deleted_at is null"])
      .toString()
      .trim(),
  )

/**
 * What is real here: the permission, the tap, the app logic, the HTTP calls to the shop and the row in the plugin's table.
 * What is replaced: the browser's subscription to the push service. Chromium refuses PushManager.subscribe in a
 * non-persistent profile ("permission denied"), and the real service (FCM) is outside this test. The stand-in returns a
 * subscription with the shape the browser would return, with the same application server key the app asked for.
 */
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const rand = (n: number, first?: number) => {
      const a = crypto.getRandomValues(new Uint8Array(n))
      if (first !== undefined) a[0] = first
      return a
    }
    const endpoint = `https://push.example.invalid/e2e/${Date.now()}-${Math.random().toString(16).slice(2)}`
    const p256dh = b64url(rand(65, 4))
    const auth = b64url(rand(16))
    let current: unknown = null
    const make = (key: ArrayBuffer) => ({
      endpoint,
      options: { applicationServerKey: key },
      toJSON: () => ({ endpoint, keys: { p256dh, auth } }),
      unsubscribe: async () => {
        current = null
        return true
      },
    })
    PushManager.prototype.getSubscription = async () => current as PushSubscription | null
    PushManager.prototype.subscribe = async (options?: PushSubscriptionOptionsInit) => {
      current = make(options!.applicationServerKey as ArrayBuffer)
      return current as PushSubscription
    }
  })
})

test("enabling notifications registers this device at the shop, and logout removes it", async ({ page, context }) => {
  await context.grantPermissions(["notifications"], { origin: BASE })
  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).click()
  await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()

  // The app asks for nothing on its own: no row before the tap.
  const before = rows()
  await page.goto("more")
  await expect(page.getByRole("button", { name: "Mitteilungen aktivieren" })).toBeVisible()
  expect(rows()).toBe(before)

  await page.getByRole("button", { name: "Mitteilungen aktivieren" }).click()
  await expect(page.getByText("Mitteilungen sind an")).toBeVisible({ timeout: 20_000 })
  expect(rows()).toBe(before + 1)
  await expect(page.getByRole("button", { name: "Testmitteilung senden" })).toBeVisible()

  // Logout removes the device at the shop before the session ends.
  await page.getByRole("button", { name: "Abmelden" }).click()
  await expect(page.getByRole("button", { name: "Mit Google anmelden" })).toBeVisible()
  expect(rows()).toBe(before)
})

test("the low-stock threshold set in 'Mehr' is stored at the shop for this device", async ({ page, context }) => {
  await context.grantPermissions(["notifications"], { origin: BASE })
  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).click()
  await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()
  await page.goto("more")
  await page.getByRole("button", { name: "Mitteilungen aktivieren" }).click()
  await expect(page.getByText("Mitteilungen sind an")).toBeVisible({ timeout: 20_000 })

  // The row appears with the plugin's answer: on by default, from stock 5.
  const row = page.getByRole("switch", { name: "Bestand niedrig" })
  await expect(row).toBeChecked()
  const group = page.getByRole("group", { name: "Meldung ab Bestand" })
  const value = group.locator("output")
  await expect(value).toHaveText("5")

  // Four taps are one request, and the shop holds the number afterwards (the device's own row in the plugin's table).
  const writes: string[] = []
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/admin/medusify/push-preferences") && writes.push(r.postData() ?? ""))
  for (let i = 0; i < 4; i++) await group.getByRole("button", { name: "Eins mehr" }).click()
  await expect(value).toHaveText("9")
  await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1)
  expect(JSON.parse(writes[0]!)).toMatchObject({ low_stock_threshold: 9 })
  // The shop holds it for this device (the stand-in subscription is new on every page load, so the proof is the shop's own answer).
  const endpoint = (JSON.parse(writes[0]!) as { endpoint: string }).endpoint
  const stored = await fetch(`${BASE}/admin/medusify/push-preferences?endpoint=${encodeURIComponent(endpoint)}`, { headers: { authorization: `Bearer ${await adminToken()}` } })
  expect(stored.status).toBe(200)
  expect(await stored.json()).toMatchObject({ low_stock_threshold: 9, kinds: { low_stock: true } })

  // The switch turns the kind off and hides the number.
  await page.getByRole("switch", { name: "Bestand niedrig" }).click() // the switch follows the shop's answer, so wait for it
  await expect(page.getByRole("switch", { name: "Bestand niedrig" })).not.toBeChecked()
  await expect(page.getByRole("group", { name: "Meldung ab Bestand" })).toHaveCount(0)
  const off = await fetch(`${BASE}/admin/medusify/push-preferences?endpoint=${encodeURIComponent(endpoint)}`, { headers: { authorization: `Bearer ${await adminToken()}` } })
  expect(await off.json()).toMatchObject({ kinds: { low_stock: false } })
})

test("the daily summary in 'Mehr': off by default, on at 20:00 on the device's clock, the hour changes, off again", async ({ page, context }) => {
  await context.grantPermissions(["notifications"], { origin: BASE })
  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).click()
  await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()
  await page.goto("more")
  await page.getByRole("button", { name: "Mitteilungen aktivieren" }).click()
  await expect(page.getByText("Mitteilungen sind an")).toBeVisible({ timeout: 20_000 })

  const writes: string[] = []
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/admin/medusify/push-preferences") && writes.push(r.postData() ?? ""))
  const toggle = page.getByRole("switch", { name: "Tagesbilanz" })
  await expect(toggle).not.toBeChecked()
  await expect(page.getByRole("combobox", { name: /Tagesbilanz, Uhrzeit/ })).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toBeChecked()
  const hour = page.getByRole("combobox", { name: /Tagesbilanz, Uhrzeit/ })
  await expect(hour).toHaveValue("20")
  expect(JSON.parse(writes[0]!)).toMatchObject({ daily_summary: { hour: 20, tz: "Europe/Vienna" } })
  await expect(page.getByText(/einmal täglich zur gewählten Uhrzeit \(Europe\/Vienna\)/)).toBeVisible()

  await hour.selectOption("7")
  await expect.poll(() => writes.length).toBe(2)
  const endpoint = (JSON.parse(writes[0]!) as { endpoint: string }).endpoint
  const read = async () => (await (await fetch(`${BASE}/admin/medusify/push-preferences?endpoint=${encodeURIComponent(endpoint)}`, { headers: { authorization: `Bearer ${await adminToken()}` } })).json()) as { daily_summary: unknown }
  await expect.poll(async () => (await read()).daily_summary).toEqual({ hour: 7, tz: "Europe/Vienna" })

  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(hour).toHaveCount(0)
  expect((await read()).daily_summary).toBeNull()
})
