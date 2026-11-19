import { expect, test } from "@playwright/test"
import { adminToken, lastShippedTracking, signInWithPassword, toShipCount } from "./helpers"

// Order of the journey matters: sign in once (with MFA), then everything else reuses that session.
test.describe.configure({ mode: "serial" })

test.describe("iPhone journey", () => {
  test("sign in with email, password and MFA code, then Start", async ({ page, context }) => {
    await signInWithPassword(page)
    await expect(page.getByText("zu versenden").first()).toBeVisible()
    await expect(page.getByRole("link", { name: "Versand starten" })).toBeVisible()
    await context.storageState({ path: "e2e/.auth/state.json" })
  })

  test.describe("signed in", () => {
    test.use({ storageState: "e2e/.auth/state.json" })

    test("install hint: one line with a close cross, the steps open on tap, the cross hides it", async ({ page }) => {
      await page.goto("")
      await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()
      const hint = page.locator(".install")
      await expect(hint).toBeVisible()
      await expect(hint.getByRole("button", { name: "Schließen" })).toBeVisible() // visible while closed
      expect((await hint.boundingBox())!.height).toBeLessThan(70) // one row, not a quarter of the screen
      await expect(hint.locator("li").first()).toBeHidden()
      await hint.locator("summary").click()
      await expect(hint.locator("li")).toHaveCount(3)
      await expect(hint.locator("li").first()).toBeVisible()
      await hint.getByRole("button", { name: "Schließen" }).click()
      await expect(hint).toHaveCount(0)
    })

    test("opens an order from the list", async ({ page }) => {
      await page.goto("orders")
      await expect(page.getByRole("heading", { name: "Bestellungen" }).first()).toBeVisible()
      await page.locator("a.row").first().click()
      await expect(page.getByText("Kunde und Lieferung")).toBeVisible()
      await expect(page.getByText("Artikel", { exact: true })).toBeVisible()
    })

    test("ships an order with a tracking number and it counts as shipped", async ({ page }) => {
      const token = await adminToken()
      // One number per run: an earlier run's shipment must not satisfy the check below.
      const tracking = `RR${String(Date.now()).slice(-9)}AT`
      expect(await lastShippedTracking(token)).not.toContain(tracking)
      const before = await toShipCount(token)
      expect(before).toBeGreaterThan(0)

      await page.goto("")
      await page.getByRole("link", { name: "Versand starten" }).click()
      await page.getByLabel("Sendungsnummer", { exact: true }).fill(tracking)
      await page.getByRole("button", { name: "Als versendet markieren" }).click()
      await expect(page.getByText("Versendet", { exact: true }).first()).toBeVisible()

      await expect.poll(() => toShipCount(token)).toBe(before - 1)
      // Medusa itself holds a shipped fulfillment with this number: the order line ids the app sends were accepted.
      await expect.poll(() => lastShippedTracking(token)).toContain(tracking)
      await page.goto("orders")
      await page.getByRole("button", { name: "Versendet" }).click()
      await expect(page.locator("a.row").first()).toBeVisible()
    })
  })
})
