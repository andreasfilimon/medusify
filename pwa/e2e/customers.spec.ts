import { expect, test } from "@playwright/test"
import { signInWithPassword } from "./helpers"

// Stage 3, customers, against the dev shop. The customers are the guests Medusa made from the demo orders
// (dev-shop/src/scripts/seed-demo-orders.ts: invented buyers, example.invalid addresses). Read only.
test.describe.configure({ mode: "serial" })
test.use({ storageState: "e2e/.auth/customers.json" })

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/customers.json" })
  await context.close()
})

test("customers: from More to the list, search, the profile with its orders, and back from an order to the profile", async ({ page }) => {
  await page.goto("more")
  await page.getByRole("link", { name: "Kunden" }).click()
  await expect(page.getByRole("heading", { name: "Kunden" }).first()).toBeVisible()
  await page.getByRole("searchbox", { name: "Name, E-Mail oder Firma" }).fill("lindner")
  // a guest has only an email on the customer: the name comes from the order
  const row = page.getByRole("link", { name: /^Greta Lindner/ })
  await expect(row).toBeVisible()
  await expect(row).toContainText("1 Bestellung")
  await row.click()
  await expect(page.getByRole("heading", { name: "Greta Lindner" }).first()).toBeVisible()
  await expect(page.getByText("Ausgegeben")).toBeVisible()
  await expect(page.getByRole("link", { name: /greta\.lindner@example\.invalid/ })).toHaveAttribute("href", "mailto:greta.lindner@example.invalid")
  await expect(page.getByText("Gast ohne Kundenkonto")).toBeVisible()
  const order = page.getByRole("region", { name: "Bestellungen" }).getByRole("link").first()
  await expect(order).toBeVisible()
  await order.click()
  await page.getByRole("link", { name: "Kundenprofil" }).click()
  await expect(page.getByRole("heading", { name: "Greta Lindner" }).first()).toBeVisible()
})

test("customers: a search without a hit says so", async ({ page }) => {
  await page.goto("customers")
  await page.getByRole("searchbox", { name: "Name, E-Mail oder Firma" }).fill("zzz-niemand")
  await expect(page.getByText("zzz-niemand")).toBeVisible()
})
