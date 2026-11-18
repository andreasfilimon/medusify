import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { adminToken, BASE, signInWithPassword } from "./helpers"

/**
 * A kit order (3 sets of 2 pots + 1 cup) that somebody packed in two steps in the Medusa admin: 1 set, then 2 sets. Both
 * fulfillments are open. Shipping from the app must ship both; with a count of the raw fulfillment item quantities the
 * second one stayed open and the order never read as shipped. The order comes from the dev shop's kit seed,
 * a fresh one per run, and is found by its id.
 */
test.describe.configure({ mode: "serial" })

const shopDir = join(import.meta.dirname, "../../dev-shop")

/** The next 30 s TOTP window: the sign-in above used a code of the current one. */
async function untilNextTotpWindow(since: number) {
  while (Math.floor(Date.now() / 30_000) === Math.floor(since / 30_000)) await new Promise((r) => setTimeout(r, 500))
}

test("a kit order in two open fulfillments ships completely from the order screen", async ({ page }) => {
  test.setTimeout(240_000)

  await signInWithPassword(page)
  const signedInAt = Date.now()

  const out = execFileSync("npx", ["medusa", "exec", "./src/scripts/seed-demo-kit.ts"], {
    cwd: shopDir,
    env: { ...process.env, SEED_KIT_ORDERS: "1" },
    encoding: "utf8",
    timeout: 150_000,
  })
  const found = /Kit order #\d+: .*\((order_[0-9A-Za-z]+), line (ordli_[0-9A-Za-z]+)\)/.exec(out)
  if (!found) throw new Error(`kit seed did not report an order:\n${out.slice(-600)}`)
  const [, orderId, lineId] = found as unknown as [string, string, string]

  await untilNextTotpWindow(signedInAt)
  const token = await adminToken()
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(BASE + path, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } })
    expect(res.ok, `${init.method ?? "GET"} ${path} -> ${res.status}`).toBe(true)
    return (await res.json()) as any
  }

  // Packed in the admin: two partial fulfillments of the one kit line.
  const location = (await api("/admin/stock-locations?fields=id")).stock_locations[0].id as string
  for (const quantity of [1, 2]) {
    await api(`/admin/orders/${orderId}/fulfillments`, {
      method: "POST",
      body: JSON.stringify({ items: [{ id: lineId, quantity }], location_id: location, no_notification: true }),
    })
  }
  const read = async () =>
    (await api(`/admin/orders/${orderId}?fields=id,fulfillment_status,*items.detail,*fulfillments,*fulfillments.items`)).order as {
      fulfillment_status: string
      items: { detail: { fulfilled_quantity: number; shipped_quantity: number } }[]
      fulfillments: { shipped_at: string | null; canceled_at: string | null; items: { quantity: number }[] }[]
    }
  const before = await read()
  // The state the bug needs: all sets fulfilled, none shipped, two open fulfillments whose item quantities add up to 3 x the sets.
  expect(before.items[0]!.detail).toMatchObject({ fulfilled_quantity: 3, shipped_quantity: 0 })
  expect(before.fulfillments.filter((f) => !f.shipped_at && !f.canceled_at)).toHaveLength(2)

  await page.goto(`orders/${orderId}`)
  await page.getByRole("button", { name: "Versenden", exact: true }).click()
  await page.getByLabel("Sendungsnummer", { exact: true }).fill(`RR${String(Date.now()).slice(-9)}AT`)
  await page.getByRole("button", { name: "Als versendet markieren" }).click()
  await expect(page.getByText("Versendet", { exact: true }).first()).toBeVisible()

  await expect.poll(async () => (await read()).fulfillment_status).toBe("shipped")
  const after = await read()
  expect(after.fulfillments.filter((f) => f.shipped_at && !f.canceled_at)).toHaveLength(2)
  expect(after.fulfillments.filter((f) => !f.shipped_at && !f.canceled_at)).toHaveLength(0)
  expect(after.items[0]!.detail).toMatchObject({ fulfilled_quantity: 3, shipped_quantity: 3 })
})
