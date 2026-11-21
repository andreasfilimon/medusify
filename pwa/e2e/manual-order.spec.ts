import { expect, test } from "@playwright/test"
import { BASE, adminToken, signInWithPassword } from "./helpers"

// Stage 3, order by hand, against the dev shop: a guest by email, two gift vouchers (no stock tracked), standard shipping,
// an address, money already there. Demo data only (example.invalid).
const EMAIL = `e2e-${Date.now().toString(36)}@example.invalid`
let token: string

test.describe.configure({ mode: "serial" })
// Without the service worker, so that page.route sees every request the app makes.
test.use({ storageState: "e2e/.auth/manual-order.json", serviceWorkers: "block" })

test.beforeAll(async ({ browser }) => {
  token = await adminToken()
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/manual-order.json" })
  await context.close()
})

async function ordersOf(email: string) {
  const fields = "id,display_id,email,status,payment_status,items.quantity,items.title,shipping_methods.name,shipping_address.city"
  const res = await fetch(`${BASE}/admin/orders?q=${encodeURIComponent(email)}&fields=${fields}`, { headers: { authorization: `Bearer ${token}` } })
  return ((await res.json()) as { orders: Record<string, any>[] }).orders.filter((o) => o.email === email)
}

test("order by hand: guest, two vouchers, standard shipping, paid; a double tap makes one order", async ({ page }) => {
  await page.goto("orders")
  await page.getByRole("link", { name: "Bestellung von Hand" }).click()
  await expect(page.getByRole("heading", { name: "Bestellung anlegen" }).first()).toBeVisible()

  // nothing filled: the form says what is missing and sends nothing
  await page.getByRole("button", { name: "Bestellung anlegen" }).click()
  await expect(page.getByText("Wähle einen Kunden oder gib eine E-Mail ein.")).toBeVisible()
  await expect(page.getByText("Füge mindestens einen Artikel hinzu.")).toBeVisible()

  await page.getByLabel("Name oder E-Mail").fill(EMAIL)
  await expect(page.getByText(`Neu als Gast mit ${EMAIL}`)).toBeVisible()
  await page.getByRole("button", { name: "Artikel hinzufügen" }).click()
  const sheet = page.getByRole("dialog", { name: "Artikel wählen" })
  await sheet.getByRole("searchbox").fill("Geschenkgutschein")
  await sheet.getByRole("button", { name: /Geschenkgutschein/ }).first().click()
  await expect(sheet).toBeHidden()
  await page.getByRole("button", { name: "Artikel hinzufügen" }).click()
  await page.getByRole("dialog", { name: "Artikel wählen" }).getByRole("searchbox").fill("Geschenkgutschein")
  await page.getByRole("dialog", { name: "Artikel wählen" }).getByRole("button", { name: /Geschenkgutschein/ }).first().click()
  await expect(page.getByText(/2 × (€\s?)?25,00/)).toBeVisible()

  const standard = await page.getByLabel("Versandart").locator("option", { hasText: "Standard" }).first().getAttribute("value")
  await page.getByLabel("Versandart").selectOption(standard!)
  // shipping needs an address: after the first try the form says so at once and keeps the button off until it is there
  await expect(page.getByText("Für den Versand braucht es eine Lieferadresse.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Bestellung anlegen" })).toBeDisabled()
  await page.getByLabel("Nachname").fill("Kundin")
  await page.getByLabel("Straße und Hausnummer").fill("Teststrasse 3")
  await page.getByLabel("PLZ").fill("10115")
  await page.getByLabel("Ort").fill("Berlin")
  const at = await page.getByLabel("Land").locator("option").filter({ hasText: /Deutschland|Germany/ }).first().getAttribute("value")
  await page.getByLabel("Land").selectOption(at!)
  await page.getByRole("switch", { name: /Geld ist schon da/ }).click()

  // a double tap: one order
  const submit = page.getByRole("button", { name: "Bestellung anlegen" })
  await submit.dblclick()
  await expect(page.getByText(/Bestellung #\d+ angelegt\./)).toBeVisible()
  await expect(page).toHaveURL(/\/orders\/order_/)

  const orders = await ordersOf(EMAIL)
  expect(orders).toHaveLength(1)
  expect(orders[0]).toMatchObject({ status: "pending", payment_status: "captured", shipping_address: { city: "Berlin" } })
  expect(orders[0]!.items.map((i: any) => Number(i.quantity))).toEqual([2])
  expect(orders[0]!.shipping_methods.map((m: any) => m.name).join()).toMatch(/Standard/)
})

async function fillOrder(page: import("@playwright/test").Page, email: string) {
  await page.getByRole("link", { name: "Bestellung von Hand" }).click()
  await page.getByLabel("Name oder E-Mail").fill(email)
  await page.getByRole("button", { name: "Artikel hinzufügen" }).click()
  const sheet = page.getByRole("dialog", { name: "Artikel wählen" })
  await sheet.getByRole("searchbox").fill("Geschenkgutschein")
  await sheet.getByRole("button", { name: /Geschenkgutschein/ }).first().click()
  await expect(sheet).toBeHidden()
}

test("a lost answer locks the form, also out of the screen and back, until the shop is asked: it was made, so one order (review 2026-11-20)", async ({ page }) => {
  const email = `e2e-lost-${Date.now().toString(36)}@example.invalid`
  let posts = 0
  // the shop makes the order, the answer never reaches the app
  await page.route("**/admin/medusify/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    posts++
    await route.fetch()
    return route.abort()
  })
  await page.goto("orders")
  await fillOrder(page, email)
  const submit = page.getByRole("button", { name: "Bestellung anlegen" })
  await submit.click()
  await expect(page.getByText(/Erst nachsehen, ob die Bestellung schon angelegt ist/)).toBeVisible()
  await expect(submit).toBeDisabled()
  expect(await ordersOf(email)).toHaveLength(1)

  // out of the screen (inside the app, so its memory stays) and in again, with another count: still locked
  await page.getByRole("button", { name: "Zurück" }).first().click()
  await expect(page).toHaveURL(/\/orders$/)
  await fillOrder(page, email)
  await expect(page.getByRole("button", { name: "Bestellung anlegen" })).toBeDisabled()
  await page.getByRole("button", { name: "Beim Shop nachsehen" }).click()
  await expect(page.getByText(/Bestellung #\d+ war schon angelegt\./)).toBeVisible()
  await expect(page).toHaveURL(/\/orders\/order_/)
  expect(posts).toBe(1)
  expect(await ordersOf(email)).toHaveLength(1)
})

test("a lost request the shop never got: asking frees the form, the next send makes the order once", async ({ page }) => {
  const email = `e2e-void-${Date.now().toString(36)}@example.invalid`
  let posts = 0
  await page.route("**/admin/medusify/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    posts++
    return posts === 1 ? route.abort() : route.continue()
  })
  await page.goto("orders")
  await fillOrder(page, email)
  const submit = page.getByRole("button", { name: "Bestellung anlegen" })
  await submit.click()
  await expect(submit).toBeDisabled()
  await page.getByRole("button", { name: "Beim Shop nachsehen" }).click()
  await expect(page.getByRole("button", { name: "Beim Shop nachsehen" })).toBeHidden()
  await expect(submit).toBeEnabled()
  expect(await ordersOf(email)).toHaveLength(0)
  await submit.click()
  await expect(page.getByText(/Bestellung #\d+ angelegt\./)).toBeVisible()
  expect(posts).toBe(2)
  expect(await ordersOf(email)).toHaveLength(1)
})
