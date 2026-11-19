import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { BASE, adminToken, signInWithPassword } from "./helpers"

// Capture, partial refund, cancel and a return with refund, against the dev shop and its real Medusa workflows.
// Fresh orders for each run come from the shop's own seed script; money only moves in the system payment provider (test data).
const shopDir = join(import.meta.dirname, "../../dev-shop")
type Seeded = Record<"authorized" | "refund" | "cancel" | "ret", { id: string; display_id: number; total: number }>
let orders: Seeded
let token: string

test.describe.configure({ mode: "serial" })
test.use({ storageState: "e2e/.auth/actions.json" })

test.beforeAll(async ({ browser }) => {
  execFileSync("npx", ["medusa", "exec", "./src/scripts/seed-demo-actions.ts"], { cwd: shopDir, timeout: 180_000, stdio: "pipe" })
  orders = JSON.parse(readFileSync(join(shopDir, ".e2e-actions.json"), "utf8")) as Seeded
  token = await adminToken()
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/actions.json" })
  await context.close()
})

type Payment = { captured_at: string | null; captures: { amount: number }[]; refunds: { amount: number }[] }
async function readOrder(id: string) {
  const fields = encodeURIComponent("id,status,payment_status,*payment_collections,*payment_collections.payments,*payment_collections.payments.captures,*payment_collections.payments.refunds")
  const res = await fetch(`${BASE}/admin/orders/${id}?fields=${fields}`, { headers: { authorization: `Bearer ${token}` } })
  const body = (await res.json()) as { order: { status: string; payment_status: string; payment_collections: { payments: Payment[] }[] } }
  const payments = body.order.payment_collections.flatMap((c) => c.payments)
  const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + Number(r.amount), 0)
  return {
    status: body.order.status,
    payment_status: body.order.payment_status,
    captured: payments.some((p) => p.captured_at),
    capturedSum: payments.reduce((s, p) => s + sum(p.captures), 0),
    refundedSum: payments.reduce((s, p) => s + sum(p.refunds), 0),
  }
}

async function open(page: Page, id: string) {
  await page.goto(`orders/${id}`)
  await expect(page.getByText("Kunde und Lieferung")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Bearbeiten" })).toBeVisible()
}

test("contact links: tel and mailto of the customer", async ({ page }) => {
  await open(page, orders.authorized.id)
  await expect(page.locator('a[href="tel:+436600000000"]')).toBeVisible()
  await expect(page.locator('a[href^="mailto:aria.autorisiert@example.invalid"]')).toBeVisible()
})

test("capture: an authorized payment is taken", async ({ page }) => {
  const id = orders.authorized.id
  expect(await readOrder(id)).toMatchObject({ payment_status: "authorized", captured: false })
  await open(page, id)
  await expect(page.getByRole("button", { name: /Erstatten/ })).toHaveCount(0) // nothing captured yet, nothing to refund
  await page.getByRole("button", { name: /Zahlung erfassen/ }).click()
  await page.getByRole("button", { name: /€\s24,70 einziehen/ }).click()
  await expect(page.getByText("Zahlung erfasst").first()).toBeVisible()
  await expect.poll(async () => (await readOrder(id)).payment_status).toBe("captured")
  expect((await readOrder(id)).capturedSum).toBeCloseTo(24.7, 2)
  await expect(page.getByRole("button", { name: /Zahlung erfassen/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Erstatten/ })).toBeVisible() // now there is money to give back
})

test("partial refund: the limit is checked before a request, only the red button refunds", async ({ page }) => {
  const id = orders.refund.id
  const refundCalls: string[] = []
  page.on("request", (r) => r.url().includes("/refund") && refundCalls.push(r.url()))
  await open(page, id)
  await page.getByRole("button", { name: /Erstatten/ }).click()
  const field = page.getByLabel(/Betrag in EUR/)

  await field.fill("39,01")
  await field.blur()
  await expect(page.getByText(/Höchstens .*39,00.* erstattbar/)).toBeVisible()
  await expect(page.getByRole("button", { name: "Weiter" })).toBeDisabled()

  await field.fill("10")
  await page.getByRole("button", { name: "Weiter" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("heading", { name: "Bestätigen" })).toBeVisible()
  await expect(sheet.getByText("EUR", { exact: true })).toBeVisible()
  await expect(sheet.locator(".kv", { hasText: "Shop" }).locator("dd")).not.toBeEmpty()
  await expect(sheet.locator(".kv", { hasText: "Bestellung" }).locator("dd")).toHaveText(`#${orders.refund.display_id}`)
  expect(refundCalls).toHaveLength(0) // nothing has left the app yet
  expect((await readOrder(id)).refundedSum).toBe(0)

  const red = sheet.locator("button.danger")
  await expect(red).toHaveText(/€\s10,00 erstatten/)
  await red.dblclick() // a double tap is one request
  await expect(page.getByText("Erstattet", { exact: true }).first()).toBeVisible()
  await expect.poll(async () => (await readOrder(id)).refundedSum).toBeCloseTo(10, 2)
  expect(refundCalls).toHaveLength(1)
  expect((await readOrder(id)).payment_status).toBe("partially_refunded")
  await expect(page.getByText(/Noch €\s29,00 erstattbar/)).toBeVisible()
})

test("cancel: the order is canceled and the captured money goes back", async ({ page }) => {
  const id = orders.cancel.id
  await open(page, id)
  await page.getByRole("button", { name: "Bestellung stornieren" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText(new RegExp(`#${orders.cancel.display_id} bei `))).toBeVisible()
  await sheet.locator("button.danger").click()
  await expect(page.getByText("Bestellung storniert").first()).toBeVisible()
  await expect.poll(async () => (await readOrder(id)).status).toBe("canceled")
  const after = await readOrder(id)
  expect(after.refundedSum).toBeCloseTo(orders.cancel.total, 2)
  await expect(page.getByRole("button", { name: "Bestellung stornieren" })).toHaveCount(0)
})

test("return with refund: receipt is confirmed and the money for the units goes back", async ({ page }) => {
  const id = orders.ret.id
  await open(page, id)
  await page.getByRole("button", { name: /Retoure annehmen/ }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("button", { name: "Weiter" })).toBeDisabled() // nothing chosen yet
  await sheet.getByRole("button", { name: "Mehr" }).first().click()
  await sheet.getByRole("switch").check()
  await expect(sheet.getByLabel(/Betrag in EUR/)).toHaveValue("6,50")
  await sheet.getByRole("button", { name: "Weiter" }).click()
  const red = sheet.locator("button.danger")
  await expect(red).toHaveText(/Eingang bestätigen und €\s6,50 erstatten/)
  await red.click()
  await expect(page.getByText("Retoure angenommen und erstattet").first()).toBeVisible()
  await expect.poll(async () => (await readOrder(id)).refundedSum).toBeCloseTo(6.5, 2)

  const res = await fetch(`${BASE}/admin/returns?order_id=${id}&fields=id,status,*items`, { headers: { authorization: `Bearer ${token}` } })
  const { returns } = (await res.json()) as { returns: { status: string; items: { received_quantity: number; quantity: number }[] }[] }
  expect(returns).toHaveLength(1)
  expect(returns[0]!.status).toBe("received")
  expect(returns[0]!.items.reduce((s, i) => s + Number(i.received_quantity), 0)).toBe(1)
})
