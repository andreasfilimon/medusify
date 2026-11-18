import { execFileSync } from "node:child_process"
import { expect, test } from "@playwright/test"
import { BASE } from "./helpers"

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
