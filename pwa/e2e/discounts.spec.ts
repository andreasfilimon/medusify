import { expect, test } from "@playwright/test"
import { BASE, adminToken, signInWithPassword } from "./helpers"

// Stage 3, discount codes, against the dev shop: create a code, pause it, resume it. The code is removed again at the end.
const CODE = `E2E${Date.now().toString(36).toUpperCase()}`
let token: string

test.describe.configure({ mode: "serial" })
test.use({ storageState: "e2e/.auth/discounts.json" })

test.beforeAll(async ({ browser }) => {
  token = await adminToken()
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/discounts.json" })
  await context.close()
})

test.afterAll(async () => {
  const res = await fetch(`${BASE}/admin/promotions?code=${CODE}&fields=id`, { headers: { authorization: `Bearer ${token}` } })
  for (const p of ((await res.json()) as { promotions: { id: string }[] }).promotions) {
    await fetch(`${BASE}/admin/promotions/${p.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } })
  }
})

async function promotion() {
  const res = await fetch(`${BASE}/admin/promotions?code=${CODE}&fields=id,code,status,limit,application_method.type,application_method.value,application_method.target_type`, { headers: { authorization: `Bearer ${token}` } })
  return ((await res.json()) as { promotions: Record<string, any>[] }).promotions[0]
}

test("discount codes: create a 15 % code limited to 50 uses, then pause and resume it", async ({ page }) => {
  await page.goto("more")
  await page.getByRole("link", { name: "Rabattcodes" }).click()
  await expect(page.getByRole("heading", { name: "Rabattcodes" }).first()).toBeVisible()
  await page.getByRole("button", { name: "Neuer Rabattcode" }).click()
  const sheet = page.getByRole("dialog", { name: "Neuer Rabattcode" })
  await sheet.getByLabel("Code").fill(CODE.toLowerCase())
  // a mistake is caught before anything is sent
  await sheet.getByLabel("Rabatt in %").fill("150")
  await page.getByRole("button", { name: "Anlegen" }).click()
  await expect(sheet.getByText("Zwischen 0 und 100 %.")).toBeVisible()
  await sheet.getByLabel("Rabatt in %").fill("15")
  await sheet.getByLabel("Wie oft einlösbar").fill("50")
  await page.getByRole("button", { name: "Anlegen" }).click()
  await expect(page.getByText(`${CODE} gilt ab sofort.`)).toBeVisible()

  expect(await promotion()).toMatchObject({ code: CODE, status: "active", limit: 50, application_method: { type: "percentage", value: 15, target_type: "order" } })
  await page.getByRole("searchbox", { name: "Code suchen" }).fill(CODE)
  const row = page.locator(".row", { hasText: CODE })
  await expect(row).toContainText("15 %")
  await expect(row).toContainText("0 von 50 eingelöst")
  await expect(row).toContainText("Aktiv")

  await row.getByRole("button", { name: `${CODE} pausieren` }).click()
  await expect(row).toContainText("Pausiert")
  expect((await promotion()).status).toBe("inactive")
  await row.getByRole("button", { name: `${CODE} aktivieren` }).click()
  await expect(row).toContainText("Aktiv")
  expect((await promotion()).status).toBe("active")
})

test("discount codes: the same code a second time with another value is refused", async ({ page }) => {
  await page.goto("discounts")
  await page.getByRole("button", { name: "Neuer Rabattcode" }).click()
  const sheet = page.getByRole("dialog", { name: "Neuer Rabattcode" })
  await sheet.getByLabel("Code").fill(CODE)
  await sheet.getByLabel("Rabatt in %").fill("30")
  await page.getByRole("button", { name: "Anlegen" }).click()
  await expect(sheet.getByText("Diesen Code gibt es schon mit einem anderen Rabatt.")).toBeVisible()
  expect((await promotion()).application_method.value).toBe(15)
})
