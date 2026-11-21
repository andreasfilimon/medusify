import { expect, test } from "@playwright/test"
import { BASE, adminCall, adminToken, catalogProducts, signInWithPassword } from "./helpers"

// Stage 3, changing an order, against the dev shop: a paid order of one gift voucher (made by hand through the plugin)
// gets a second voucher. The app shows the price first, a double tap makes one change, and what is open to pay shows
// as "mark as paid" afterwards. Demo data only (example.invalid).
const EMAIL = `e2e-change-${Date.now().toString(36)}@example.invalid`
let token: string
let orderId: string

test.describe.configure({ mode: "serial" })
test.use({ storageState: "e2e/.auth/order-change.json" })

async function readOrder(id: string) {
  const fields = "id,items.quantity,items.title,summary.pending_difference"
  const res = await fetch(`${BASE}/admin/orders/${id}?fields=${fields}`, { headers: { authorization: `Bearer ${token}` } })
  const o = ((await res.json()) as { order: Record<string, any> }).order
  return { quantities: (o.items as any[]).map((i) => Number(i.quantity)), pending: Number(o.summary?.pending_difference ?? 0) }
}

async function changesOf(id: string) {
  const res = await fetch(`${BASE}/admin/orders/${id}/changes`, { headers: { authorization: `Bearer ${token}` } })
  return ((await res.json()) as { order_changes: { status: string; change_type: string }[] }).order_changes
}

test.beforeAll(async ({ browser }) => {
  token = await adminToken()
  const setup = (await (await fetch(`${BASE}/admin/medusify/orders/setup`, { headers: { authorization: `Bearer ${token}` } })).json()) as { regions: { id: string; currency_code: string }[] }
  const region = setup.regions.find((r) => r.currency_code === "eur")!
  const voucher = (await catalogProducts(token, "Geschenkgutschein"))[0]!.variants[0]!
  const made = await adminCall(token, "/admin/medusify/orders", {
    region_id: region.id,
    email: EMAIL,
    items: [{ variant_id: voucher.id, quantity: 1 }],
    paid: true,
    idempotency_key: `e2e-change-${Date.now()}`,
  })
  orderId = made.order_id
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/order-change.json" })
  await context.close()
})

test("edit an order: one more voucher, the price is shown first, a double tap makes one change", async ({ page }) => {
  expect(await readOrder(orderId)).toEqual({ quantities: [1], pending: 0 })
  await page.goto(`orders/${orderId}`)
  await expect(page.getByRole("heading", { name: "Bearbeiten" })).toBeVisible()
  await page.getByRole("button", { name: /Bestellung ändern/ }).click()
  const sheet = page.getByRole("dialog", { name: "Bestellung ändern" })

  // nothing changed: the form says so and asks the shop nothing
  await sheet.getByRole("button", { name: "Prüfen", exact: true }).click()
  await expect(sheet.getByText("Noch nichts geändert.")).toBeVisible()

  await sheet.getByRole("group", { name: /Menge von Geschenkgutschein/ }).getByRole("button", { name: "Eins mehr" }).click()
  await sheet.getByRole("button", { name: "Prüfen", exact: true }).click()
  await expect(sheet.getByText(/^Danach sind (€\s?)?25,00( €)? offen zu bezahlen\.$/)).toBeVisible()
  await expect(sheet.locator(".kv", { hasText: "Neu" }).locator("dd")).toHaveText(/^(€\s?)?50,00( €)?$/)
  // the preview changed nothing in the shop
  expect(await readOrder(orderId)).toEqual({ quantities: [1], pending: 0 })

  await sheet.getByRole("button", { name: "Änderung ausführen" }).dblclick()
  await expect(page.getByText("Bestellung geändert.")).toBeVisible()
  await expect(sheet).toBeHidden()
  expect(await readOrder(orderId)).toEqual({ quantities: [2], pending: 25 })
  const changes = await changesOf(orderId)
  expect(changes.filter((c) => c.change_type === "edit").map((c) => c.status)).toEqual(["confirmed"])
  // what is open now shows as "mark as paid"
  await expect(page.getByRole("button", { name: /Als bezahlt markieren/ })).toBeVisible()
})
