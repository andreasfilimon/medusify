import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { BASE, adminToken, signInWithPassword } from "./helpers"

// A refund whose answer gets lost on the way back. The real shop books it (or not); the app must never send a second refund
// by itself. Fresh demo orders come from the shop's seed script, money moves only in the system payment provider.
//   LOST_SHOTS=1 writes the two states (light and dark, 390 px) to docs/shots.
const shopDir = join(import.meta.dirname, "../../dev-shop")
const shotDir = join(import.meta.dirname, "../../docs/shots")
type Seeded = Record<"authorized" | "refund" | "cancel" | "ret", { id: string; display_id: number; total: number }>
let orders: Seeded
let token: string

test.describe.configure({ mode: "serial" })
// Without the service worker, so that page.route sees every request the app makes (a worker's own fetches bypass it).
test.use({ storageState: "e2e/.auth/lost-answer.json", serviceWorkers: "block" })

test.beforeAll(async ({ browser }) => {
  execFileSync("npx", ["medusa", "exec", "./src/scripts/seed-demo-actions.ts"], { cwd: shopDir, timeout: 180_000, stdio: "pipe" })
  orders = JSON.parse(readFileSync(join(shopDir, ".e2e-actions.json"), "utf8")) as Seeded
  token = await adminToken()
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/lost-answer.json" })
  await context.close()
})

async function refundedSum(id: string): Promise<number> {
  const fields = encodeURIComponent("*payment_collections.payments.refunds")
  const res = await fetch(`${BASE}/admin/orders/${id}?fields=${fields}`, { headers: { authorization: `Bearer ${token}` } })
  const body = (await res.json()) as { order: { payment_collections: { payments: { refunds: { amount: number }[] }[] }[] } }
  return body.order.payment_collections.flatMap((c) => c.payments).flatMap((p) => p.refunds).reduce((s, r) => s + Number(r.amount), 0)
}

async function toConfirm(page: Page, id: string, amount: string) {
  await page.goto(`orders/${id}`)
  await expect(page.getByRole("heading", { name: "Bearbeiten" })).toBeVisible()
  await page.getByRole("button", { name: /Erstatten/ }).click()
  await page.getByLabel(/Betrag in EUR/).fill(amount)
  await page.getByRole("button", { name: "Weiter" }).click()
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Bestätigen" })).toBeVisible()
}

async function shot(page: Page, name: string) {
  if (!process.env.LOST_SHOTS) return
  mkdirSync(shotDir, { recursive: true })
  await page.setViewportSize({ width: 390, height: 844 }) // the size of the other shots in docs/shots
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.waitForTimeout(400)
    const m = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: window.innerWidth }))
    expect(m.s).toBeLessThanOrEqual(m.w) // no horizontal overflow at 390 px
    await page.screenshot({ path: join(shotDir, `${name}-${scheme}.png`) })
  }
  await page.emulateMedia({ colorScheme: "light" })
}

test("lost answer, order unreadable: the lock outlives the error screen, reload frees it, one refund in the end", async ({ page }) => {
  const o = orders.refund
  const refundPosts: string[] = []
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/refund") && refundPosts.push(r.url()))
  await toConfirm(page, o.id, "10")

  // The request never reaches the shop and the order cannot be read afterwards: the outcome is unknown, the screen shows an error.
  await page.route("**/admin/payments/*/refund", (route) => route.abort())
  await page.route(`**/admin/orders/${o.id}?*`, (route) => route.abort())
  await page.getByRole("dialog").locator("button.danger").click()
  await expect(page.getByRole("heading", { name: "Bestellung konnte nicht geladen werden." })).toBeVisible()
  expect(refundPosts).toHaveLength(1)

  // Out of the order and back in, inside the app (a new page load would wipe the memory, see the README): the shop answers again,
  // but nobody has read the order after the loss, so the refund button stays locked.
  await page.waitForLoadState("networkidle") // the refresh behind the lost answer is over (a read made earlier would count as the read-back)
  await page.unroute(`**/admin/orders/${o.id}?*`)
  await page.unroute("**/admin/payments/*/refund")
  await page.getByRole("button", { name: "Bestellungen" }).click()
  await page.waitForURL(/\/medusify\/orders$/)
  await page.getByText(`#${o.display_id}`).first().click()
  await page.waitForURL(/\/orders\/order_/)
  await expect(page.getByRole("heading", { name: "Bearbeiten" })).toBeVisible()
  await page.getByRole("button", { name: /Erstatten/ }).click()
  await page.getByLabel(/Betrag in EUR/).fill("10")
  await page.getByRole("button", { name: "Weiter" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByRole("status").filter({ hasText: /nicht geantwortet/ })).toBeVisible()
  await expect(sheet.locator("button.danger")).toBeDisabled()

  // "Zurück" and forward again does not open a second try.
  await sheet.getByRole("button", { name: "Zurück" }).click()
  await sheet.getByRole("button", { name: "Weiter" }).click()
  await expect(sheet.locator("button.danger")).toBeDisabled()
  expect(refundPosts).toHaveLength(1)
  await shot(page, "11f-refund-locked")

  // Reading the order frees the button; the amount is unchanged, so the same key goes out again.
  await sheet.getByRole("button", { name: "Bestellung neu laden" }).click()
  await expect(sheet.locator("button.danger")).toBeEnabled()
  expect(await refundedSum(o.id)).toBe(0) // the request never arrived, nothing was booked
  await sheet.locator("button.danger").click()
  await expect(page.getByText("Erstattet", { exact: true }).first()).toBeVisible()
  await expect.poll(() => refundedSum(o.id)).toBeCloseTo(10, 2)
  expect(refundPosts).toHaveLength(2) // the lost one and the one after the reload, no more
})

test("lost answer, order read fails too: the screen offers a retry, and a retry that works frees the lock", async ({ page }) => {
  const o = orders.cancel
  const refundPosts: string[] = []
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/refund") && refundPosts.push(r.url()))
  await toConfirm(page, o.id, "5")

  await page.route("**/admin/payments/*/refund", (route) => route.abort())
  await page.route(`**/admin/orders/${o.id}?*`, (route) => route.abort())
  await page.getByRole("dialog").locator("button.danger").click()
  await expect(page.getByRole("heading", { name: "Bestellung konnte nicht geladen werden." })).toBeVisible()
  expect(refundPosts).toHaveLength(1)

  await page.unroute(`**/admin/orders/${o.id}?*`)
  await page.unroute("**/admin/payments/*/refund")
  await page.getByRole("button", { name: "Erneut versuchen" }).click()
  await expect(page.getByRole("heading", { name: "Bearbeiten" })).toBeVisible()
  await page.getByRole("button", { name: /Erstatten/ }).click()
  await page.getByLabel(/Betrag in EUR/).fill("5")
  await page.getByRole("button", { name: "Weiter" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.locator("button.danger")).toBeEnabled() // the order was read after the loss, nothing was booked
  expect(await refundedSum(o.id)).toBe(0)
  expect(refundPosts).toHaveLength(1)
  await sheet.locator("button.danger").click()
  await expect.poll(() => refundedSum(o.id)).toBeCloseTo(5, 2)
  expect(refundPosts).toHaveLength(2)
})

test("lost answer, shop booked it: after the reload the app shows the new state and asks nothing twice", async ({ page }) => {
  const o = orders.ret // paid and shipped, 16.20 refundable
  const refundPosts: string[] = []
  page.on("request", (r) => r.method() === "POST" && r.url().includes("/refund") && refundPosts.push(r.url()))
  await toConfirm(page, o.id, "5")

  // The shop books the refund, the answer is lost on the way back.
  await page.route("**/admin/payments/*/refund", async (route) => {
    await route.fetch()
    await route.abort()
  })
  const sheet = page.getByRole("dialog")
  await sheet.locator("button.danger").click()
  await expect.poll(() => refundedSum(o.id)).toBeCloseTo(5, 2)
  // The order could be read again and shows a smaller refundable amount: back to the amount step with a note.
  await expect(sheet.getByText(/Bestellung hat sich seitdem geändert/)).toBeVisible()
  await expect(sheet.getByLabel(/Betrag in EUR/)).toBeVisible()
  expect(refundPosts).toHaveLength(1)
  await shot(page, "11g-refund-landed")
  await page.unroute("**/admin/payments/*/refund")
  expect(await refundedSum(o.id)).toBeCloseTo(5, 2) // once, not twice
})
