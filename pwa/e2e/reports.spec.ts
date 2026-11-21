import { expect, test } from "@playwright/test"
import { signInWithPassword } from "./helpers"

// Stage 4, reports and rights, against the dev shop (demo orders of dev-shop/src/scripts/seed-demo-orders.ts). Read only.
test.describe.configure({ mode: "serial" })
test.use({ storageState: "e2e/.auth/reports.json" })

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/reports.json" })
  await context.close()
})

test("reports: from More, a week, then chosen dates with a wrong order and a right one", async ({ page }) => {
  await page.goto("more")
  await page.getByRole("link", { name: "Berichte" }).click()
  await expect(page.getByRole("heading", { name: "Berichte" }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: "7 Tage" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("heading", { name: "Umsatz" })).toBeVisible()
  await expect(page.getByText(/Verglichen mit .*gleich viele Tage davor/)).toBeVisible()

  await page.getByRole("button", { name: "Zeitraum wählen" }).click()
  await page.getByLabel("Von").fill("2026-11-10")
  await page.getByLabel("Bis").fill("2026-11-01")
  await expect(page.getByRole("alert")).toHaveText("Das Ende liegt vor dem Anfang.")

  await page.getByLabel("Von").fill("2026-01-01")
  await page.getByLabel("Bis").fill(new Date().toISOString().slice(0, 10))
  await expect(page.getByRole("alert")).toHaveCount(0)
  // the demo orders are paid and shipped in this year: there is revenue and a best seller
  const top = page.getByRole("region", { name: "Meistverkauft" })
  await expect(top.getByText(/\d+ Stück$/).first()).toBeVisible()
  await expect(page.getByRole("region", { name: "Bestellungen und Retouren" }).getByText("Retourenquote")).toBeVisible()
})

test("rights: the dev shop has no roles, so every line says yes", async ({ page }) => {
  await page.goto("more")
  await page.getByRole("link", { name: "Deine Rechte" }).click()
  await expect(page.getByRole("heading", { name: "Deine Rechte" }).first()).toBeVisible()
  await expect(page.getByText("Dieser Shop nutzt keine Rollen: jedes Konto darf alles.")).toBeVisible()
  await expect(page.getByText("Erstatten")).toBeVisible()
  await expect(page.getByText("Nein")).toHaveCount(0)
})
