import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { expect, test } from "@playwright/test"
import { adminCall, adminToken, catalogProducts, signInWithPassword } from "./helpers"

// The camera itself: Chromium plays a clip of an EAN-13 (in-store range, 2000000000008) as its camera, the decoder reads it
// and the scanner books one unit, and only one while the same code stays in front of the lens (the hold rule).
const shopDir = join(import.meta.dirname, "../../dev-shop")
let token: string

test.describe.configure({ mode: "serial" })
test.use({ storageState: "e2e/.auth/catalog-scan.json", serviceWorkers: "block" })

test.beforeAll(async ({ browser }) => {
  execFileSync("npx", ["medusa", "exec", "./src/scripts/seed-demo-catalog.ts"], { cwd: shopDir, timeout: 180_000, stdio: "pipe" })
  token = await adminToken()
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/catalog-scan.json" })
  await context.close()
})

// Whatever happens in the test, the candle gets the stock it had back: a broken hold rule books a unit per frame.
let original: { itemId: string; locationId: string; stocked: number } | null = null
test.afterAll(async () => {
  if (!original) return
  await adminCall(token, "/admin/medusify/inventory", { mode: "set", inventory_item_id: original.itemId, location_id: original.locationId, quantity: original.stocked, idempotency_key: crypto.randomUUID() })
})

const kerze = async () => (await catalogProducts(token, "Duftkerze"))[0]!.variants[0]!.stock_total!

test("the camera reads a product code and books one unit, however long the code stays in view", async ({ page }) => {
  const v = (await catalogProducts(token, "Duftkerze"))[0]!.variants[0]!
  original = { itemId: v.inventory[0]!.inventory_item_id, locationId: v.inventory[0]!.levels[0]!.location_id, stocked: v.stock_total! }
  const before = await kerze()
  await page.goto("products")
  await page.getByRole("link", { name: "Scanner öffnen" }).click()
  await expect(page.getByRole("heading", { name: "Scanner" }).first()).toBeVisible()
  const row = page.locator(".scan-row", { hasText: "Duftkerze Lavendel" })
  await expect(row).toContainText("+1", { timeout: 20_000 })
  await expect(row).toContainText("jetzt")
  await page.waitForTimeout(4000) // the same code in front of the lens for four more seconds
  await expect(page.locator(".scan-row")).toHaveCount(1)
  expect(await kerze()).toBe(before + 1)
  await page.getByRole("button", { name: "Letzten zurücknehmen" }).click()
  await expect.poll(kerze).toBe(before)
})
