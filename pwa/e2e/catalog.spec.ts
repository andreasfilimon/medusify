import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import { BASE, adminCall, adminToken, catalogProduct, catalogProducts, signInWithPassword, type CatalogProduct } from "./helpers"

// Stage 2 against the dev shop and its real Medusa workflows: the list, a price, stock, the visibility switch, quick create
// with a photo, and the scanner with typed codes (WebKit has no camera; the camera itself is catalog-scan.spec.ts).
// Demo data from the shop's own seed script. Every test that changes the shop puts it back.
// The screens for the docs come from e2e/shots.mjs (light and dark, 390 px).
const shopDir = join(import.meta.dirname, "../../dev-shop")
let token: string
let made: { id: string; variantId: string; inventoryItemId: string; locationId: string } | null = null
const CODE_KERZE = "2000000000008"
const CODE_NEW = "2000000000999"

test.describe.configure({ mode: "serial" })
// Without the service worker, so that page.route sees every request the app makes (a worker's own fetches bypass it).
test.use({ storageState: "e2e/.auth/catalog.json", serviceWorkers: "block" })

test.beforeAll(async ({ browser }) => {
  execFileSync("npx", ["medusa", "exec", "./src/scripts/seed-demo-catalog.ts"], { cwd: shopDir, timeout: 180_000, stdio: "pipe" })
  token = await adminToken()
  // Leftovers of an earlier run that stopped half way: they would hold the test barcode.
  for (const old of await catalogProducts(token, "E2E Probestück")) await fetch(`${BASE}/admin/products/${old.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } })
  const context = await browser.newContext({ ...test.info().project.use, storageState: undefined })
  const page = await context.newPage()
  await signInWithPassword(page)
  await context.storageState({ path: "e2e/.auth/catalog.json" })
  await context.close()
})

// The one product the quick-create test makes is removed again, so a run leaves the shop as it found it.
test.afterAll(async () => {
  if (!made) return
  await fetch(`${BASE}/admin/products/${made.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } })
})

const one = async (q: string): Promise<CatalogProduct> => {
  const found = (await catalogProducts(token, q)).find((p) => p.title.includes(q))
  if (!found) throw new Error(`no product ${q}`)
  return found
}
const stock = (p: CatalogProduct, i = 0) => p.variants[i]!.stock_total
const baseOf = (p: CatalogProduct, currency: string) => p.variants[0]!.prices.find((x) => x.base && x.currency_code === currency)?.amount

/** Opens a product the way a person does in a shop with many products: search, then tap. */
async function openProduct(page: Page, title: string) {
  await page.goto("products")
  await page.getByRole("searchbox").fill(title)
  await page.locator("a.row", { hasText: title }).click()
}


test("a fourth tab lists the products with price and stock", async ({ page }) => {
  await page.goto("")
  await expect(page.getByRole("tab")).toHaveCount(4)
  await page.getByRole("tab", { name: "Produkte" }).click()
  await expect(page.getByRole("heading", { name: "Produkte" }).first()).toBeVisible()
  await expect(page.locator("a.row", { hasText: "Duftkerze Lavendel" })).toBeVisible()
  // The dev shop holds many products, the list is alphabetical and paged: the later ones are found by search, as a person would.
  await page.getByRole("searchbox").fill("Teetasse")
  await expect(page.locator("a.row", { hasText: "Teetasse Keramik" })).toContainText("2 Varianten")
  await page.getByRole("searchbox").fill("Wintermütze")
  await expect(page.locator("a.row", { hasText: "Wintermütze Wolle" })).toContainText("Entwurf")
  await expect(page.locator("a.row", { hasText: "Wintermütze Wolle" })).toContainText("Ausverkauft")
  await page.getByRole("searchbox").fill("Duftkerze")
  await page.getByRole("searchbox").fill("tasse")
  await expect(page.locator("a.row", { hasText: "Teetasse Keramik" })).toBeVisible()
  await page.getByRole("searchbox").fill("KERZE-LAV") // by SKU
  await expect(page.locator("a.row", { hasText: "Duftkerze Lavendel" })).toBeVisible()
  await page.getByRole("searchbox").fill("zzzz-nichts")
  await expect(page.getByText("Nichts gefunden")).toBeVisible()
})

test("changing a price changes that currency only", async ({ page }) => {
  const before = await one("Duftkerze")
  const usd = baseOf(before, "usd")
  const next = baseOf(before, "eur") === 15.9 ? "14,90" : "15,90"
  await openProduct(page, "Duftkerze Lavendel")
  await expect(page.getByRole("heading", { name: "Duftkerze Lavendel" }).first()).toBeVisible()
  await page.getByRole("button", { name: /^Preis EUR/ }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet).toBeVisible()
  await sheet.getByLabel("Preis in EUR").fill("15,999")
  await sheet.getByLabel("Preis in EUR").blur() // the sentence appears when the field is left, not while typing
  await expect(sheet.getByText("Höchstens 2 Nachkommastellen.")).toBeVisible()
  await sheet.getByLabel("Preis in EUR").fill(next)
  await sheet.getByRole("button", { name: "Sichern" }).click()
  await expect(page.getByText("Preis gespeichert")).toBeVisible()
  const after = await one("Duftkerze")
  expect(baseOf(after, "eur")).toBe(Number(next.replace(",", ".")))
  expect(baseOf(after, "usd")).toBe(usd) // the other currency survived the price update
  expect(after.variants[0]!.prices.length).toBe(before.variants[0]!.prices.length)
  // put the price back the way the app does it
  await page.getByRole("button", { name: /^Preis EUR/ }).click()
  await page.getByRole("dialog").getByLabel("Preis in EUR").fill(String(baseOf(before, "eur")).replace(".", ","))
  await page.getByRole("dialog").getByRole("button", { name: "Sichern" }).click()
  await expect.poll(async () => baseOf(await one("Duftkerze"), "eur")).toBe(baseOf(before, "eur"))
})

test("stock is booked as a difference, once, even when the button is hit twice", async ({ page }) => {
  const before = await one("Duftkerze")
  await openProduct(page, "Duftkerze Lavendel")
  const plus = page.getByRole("button", { name: "Eins mehr" })
  await plus.click()
  await plus.click()
  const save = page.getByRole("button", { name: "+2 speichern" })
  await save.dblclick()
  await expect(page.getByText("Bestand gespeichert")).toBeVisible()
  expect(stock(await one("Duftkerze"))).toBe(stock(before)! + 2)
  // put it back with the app: two steps down, one save
  await page.getByRole("button", { name: "Eins weniger" }).click()
  await page.getByRole("button", { name: "Eins weniger" }).click()
  await page.getByRole("button", { name: "−2 speichern" }).click()
  await expect.poll(async () => stock(await one("Duftkerze"))).toBe(stock(before))
})

test("the visibility switch makes a draft visible and back", async ({ page }) => {
  await openProduct(page, "Wintermütze Wolle")
  const sw = page.getByRole("switch", { name: /Im Shop sichtbar/ })
  await expect(sw).toHaveAttribute("aria-checked", "false")
  await sw.click()
  await expect(page.getByText("Produkt ist sichtbar")).toBeVisible()
  expect((await one("Wintermütze")).status).toBe("published")
  await sw.click()
  await expect(page.getByText("Produkt ist ein Entwurf")).toBeVisible()
  expect((await one("Wintermütze")).status).toBe("draft")
})

test("quick create makes a product with a photo, a price and stock", async ({ page }) => {
  const title = `E2E Probestück ${Date.now()}`
  await page.goto("products")
  await page.getByRole("link", { name: "Neues Produkt" }).click()
  await expect(page.getByRole("heading", { name: "Neues Produkt" }).first()).toBeVisible()
  await page.locator('input[type="file"]').first().setInputFiles(join(import.meta.dirname, "fixtures/product-photo.png"))
  await expect(page.getByRole("img", { name: "Vorschau des Produktfotos" })).toBeVisible()
  // nothing is sent while the form is incomplete
  await page.getByRole("button", { name: "Produkt anlegen" }).click()
  await expect(page.getByText("Name eingeben.")).toBeVisible()
  await page.getByLabel("Name").fill(title)
  await page.getByLabel("Preis in EUR").fill("9,90")
  await page.getByLabel("Bestand", { exact: true }).fill("7")
  await page.getByRole("button", { name: "Produkt anlegen" }).click()
  await expect(page.getByText("Produkt angelegt")).toBeVisible()
  await expect(page.getByRole("heading", { name: title }).first()).toBeVisible()
  const p = await one(title)
  expect(p.status).toBe("draft")
  expect(p.thumbnail).toBeTruthy()
  expect(baseOf(p, "eur")).toBe(9.9)
  expect(stock(p)).toBe(7)
  made = { id: p.id, variantId: p.variants[0]!.id, inventoryItemId: p.variants[0]!.inventory[0]!.inventory_item_id, locationId: p.variants[0]!.inventory[0]!.levels[0]!.location_id }
})

test("scanner: a typed code books +1 and the undo takes exactly that back", async ({ page }) => {
  const before = await one("Duftkerze")
  await page.goto("products")
  await page.getByRole("link", { name: "Scanner öffnen" }).click()
  await expect(page.getByRole("heading", { name: "Scanner" }).first()).toBeVisible()
  await expect(page.getByText("Keine Kamera. Den Code unten eintippen.")).toBeVisible()
  await page.getByLabel("Code eintippen").fill(CODE_KERZE)
  await page.getByRole("button", { name: "Suchen" }).click()
  await expect(page.locator(".scan-row", { hasText: "Duftkerze Lavendel" })).toContainText("+1")
  await expect(page.getByText("1 gebucht")).toBeVisible()
  expect(stock(await one("Duftkerze"))).toBe(stock(before)! + 1)
  await page.getByRole("button", { name: "Letzten zurücknehmen" }).click()
  await expect(page.locator(".scan-row", { hasText: "Duftkerze Lavendel" })).toContainText("±0")
  expect(stock(await one("Duftkerze"))).toBe(stock(before))
})

test("scanner: an answer that gets lost is sent again as the same booking", async ({ page }) => {
  const before = await one("Duftkerze")
  let lost = false
  await page.route("**/admin/medusify/inventory", async (route) => {
    if (!lost && route.request().method() === "POST") {
      lost = true
      await route.fetch() // the shop books it ...
      await route.abort("failed") // ... and the answer never arrives
    } else await route.continue()
  })
  await page.goto("products")
  await page.getByRole("link", { name: "Scanner öffnen" }).click()
  await page.getByLabel("Code eintippen").fill(CODE_KERZE)
  await page.getByRole("button", { name: "Suchen" }).click()
  const row = page.locator(".scan-row", { hasText: "Duftkerze Lavendel" })
  await expect(row.getByRole("button", { name: "Erneut senden" })).toBeVisible()
  expect(stock(await one("Duftkerze"))).toBe(stock(before)! + 1) // it was booked
  await row.getByRole("button", { name: "Erneut senden" }).click()
  await expect(row).toContainText("jetzt")
  expect(stock(await one("Duftkerze"))).toBe(stock(before)! + 1) // and the repeat booked nothing more
  await page.getByRole("button", { name: "Letzten zurücknehmen" }).click()
  await expect.poll(async () => stock(await one("Duftkerze"))).toBe(stock(before))
})

test("scanner: an unknown code is assigned to a product on the spot and counts at once", async ({ page }) => {
  expect(made).not.toBeNull()
  const title = (await catalogProduct(token, made!.id)).title
  const before = stock(await catalogProduct(token, made!.id))!
  await page.goto("products")
  await page.getByRole("link", { name: "Scanner öffnen" }).click()
  await page.getByLabel("Code eintippen").fill(CODE_NEW)
  await page.getByRole("button", { name: "Suchen" }).click()
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText(`Der Code ${CODE_NEW} gehört noch zu keinem Produkt`)).toBeVisible()
  await sheet.getByRole("searchbox").fill("E2E Probestück")
  await sheet.getByRole("button", { name: new RegExp(title) }).click()
  await expect(page.locator(".scan-row", { hasText: title })).toContainText("+1")
  const after = await catalogProduct(token, made!.id)
  expect(after.variants[0]!.barcode).toBe(CODE_NEW)
  expect(stock(after)).toBe(before + 1)
  // the code is known now: a second scan needs no sheet
  await page.getByLabel("Code eintippen").fill(CODE_NEW)
  await page.getByRole("button", { name: "Suchen" }).click()
  await expect(page.getByText("2 gebucht")).toBeVisible()
})

test("scanner: counting writes the counted number only when applied", async ({ page }) => {
  expect(made).not.toBeNull()
  const before = stock(await catalogProduct(token, made!.id))!
  await page.goto("products")
  await page.getByRole("link", { name: "Scanner öffnen" }).click()
  await page.getByRole("tab", { name: "Zählen" }).click()
  for (let i = 0; i < 3; i++) {
    await page.getByLabel("Code eintippen").fill(CODE_NEW)
    await page.getByRole("button", { name: "Suchen" }).click()
    await expect(page.getByText(`vorher ${before}`)).toBeVisible()
  }
  expect(stock(await catalogProduct(token, made!.id))).toBe(before) // nothing written yet
  await page.getByRole("button", { name: "1 Bestände übernehmen" }).click()
  await expect(page.getByText("1 Bestände übernommen")).toBeVisible()
  expect(stock(await catalogProduct(token, made!.id))).toBe(3)
})

test("a role-free sanity check: the plugin refuses a stock change without a key", async () => {
  const res = await fetch(`${BASE}/admin/medusify/inventory`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ mode: "adjust", inventory_item_id: made!.inventoryItemId, location_id: made!.locationId, quantity: 1 }) })
  expect(res.status).toBe(400)
  void adminCall
})
