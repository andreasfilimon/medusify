// Screenshots of every screen, light and dark, iPhone 15 profile (390 px wide), against the dev shop.
// Logs scrollWidth and innerWidth per shot: a horizontal overflow shows up as a difference.
//   node e2e/shots.mjs                      (docs/shots, 390 px)
//   SHOT_WIDTH=375 SHOT_OUT=/tmp/x node e2e/shots.mjs   (other width, other folder)
import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, devices, webkit } from "@playwright/test"

const BASE = process.env.E2E_BASE ?? "http://localhost:9055"
const WIDTH = Number(process.env.SHOT_WIDTH ?? 390)
const out = process.env.SHOT_OUT ?? join(import.meta.dirname, "..", "..", "docs", "shots")
mkdirSync(out, { recursive: true })

const envLine = readFileSync(join(import.meta.dirname, "..", "..", "dev-shop", ".env"), "utf8").split("\n").find((l) => l.startsWith("DEVSHOP_ADMIN_PASSWORD="))
const adminPassword = envLine.slice("DEVSHOP_ADMIN_PASSWORD=".length).trim()
// Four fresh demo orders (authorized, paid, paid, shipped) for the order action screens.
const shopDir = join(import.meta.dirname, "..", "..", "dev-shop")
execFileSync("npx", ["medusa", "exec", "./src/scripts/seed-demo-actions.ts"], { cwd: shopDir, timeout: 180_000, stdio: "pipe" })
const actionOrders = JSON.parse(readFileSync(join(shopDir, ".e2e-actions.json"), "utf8"))
const log = []
// WebKit on Linux draws no backdrop blur (measured 2026-11-19: sharp stripes stay sharp), Chromium does. The glass material
// is therefore shot in Chromium: SHOT_BROWSER=chromium.
const browser = await (process.env.SHOT_BROWSER === "chromium" ? chromium : webkit).launch()
for (const scheme of ["light", "dark"]) {
  const context = await browser.newContext({ ...devices["iPhone 15"], locale: "de-AT", timezoneId: "Europe/Vienna", viewport: { width: WIDTH, height: 844 }, colorScheme: scheme, serviceWorkers: "block", baseURL: `${BASE}/medusify/` })
  const page = await context.newPage()
  const shot = async (name) => {
    await page.waitForTimeout(350)
    const m = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, bodyScroll: document.body.scrollWidth }))
    // Side gutter: no field or button of a screen may touch the edge of the window (a lost padding went unseen once).
    const gutter = await page.evaluate(() => {
      const left = [...document.querySelectorAll(".screen input:not([type=checkbox]), .screen .btn, .screen select")]
        .filter((el) => !el.closest(".sheet") && el.getBoundingClientRect().width > 0)
        .map((el) => el.getBoundingClientRect())
      return left.length ? Math.min(...left.map((r) => Math.min(r.left, window.innerWidth - r.right))) : 99
    })
    log.push({ shot: `${name}-${scheme}`, ...m, gutter, ok: m.scrollWidth === m.innerWidth && m.bodyScroll <= m.innerWidth && gutter >= 12 })
    await page.screenshot({ path: join(out, `${name}-${scheme}.png`) })
  }

  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).waitFor()
  await shot("01-login")

  await page.getByLabel("E-Mail").fill("admin@devshop.invalid")
  await page.getByLabel("Passwort", { exact: true }).fill("not-a-real-password")
  await page.getByRole("button", { name: "Anmelden", exact: true }).click()
  await page.getByText("E-Mail oder Passwort stimmt nicht.").waitFor()
  await shot("02-login-error")

  // MFA step: right password, stop before the code (no session is created).
  await page.getByLabel("Passwort", { exact: true }).fill(adminPassword)
  await page.getByRole("button", { name: "Anmelden", exact: true }).click()
  await page.getByLabel("6-stelliger Code").waitFor()
  await shot("02b-login-mfa")

  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).click()
  await page.getByRole("heading", { name: "Start" }).first().waitFor()
  await shot("03-start")

  await page.goto("orders")
  await page.locator("a.row").first().waitFor()
  await shot("04-orders")

  await page.locator("a.row").first().click()
  await page.getByText("Kunde und Lieferung").waitFor()
  await shot("05-order-detail")

  // Order actions: the list under "Bearbeiten" of a shipped order, then the sheets.
  await page.goto(`orders/${actionOrders.ret.id}`)
  await page.getByRole("heading", { name: "Bearbeiten" }).waitFor()
  await page.getByRole("heading", { name: "Bearbeiten" }).scrollIntoViewIfNeeded()
  await shot("11-order-actions")
  await page.getByRole("button", { name: /Retoure annehmen/ }).click()
  await page.getByRole("dialog").getByRole("button", { name: "Mehr" }).first().click()
  await page.getByRole("dialog").getByRole("switch").check()
  await shot("11d-return")
  await page.goto(`orders/${actionOrders.refund.id}`)
  await page.getByRole("button", { name: /Erstatten/ }).click()
  await page.getByLabel(/Betrag in EUR/).fill("10")
  await shot("11b-refund-amount")
  await page.getByRole("button", { name: "Weiter" }).click()
  await page.getByRole("heading", { name: "Bestätigen" }).waitFor()
  await shot("11c-refund-confirm")
  await page.goto(`orders/${actionOrders.cancel.id}`)
  await page.getByRole("button", { name: "Bestellung stornieren" }).click()
  await page.getByRole("dialog").waitFor()
  await shot("11e-cancel")

  await page.goto("ship")
  await page.getByLabel("Sendungsnummer (optional)", { exact: true }).waitFor()
  await shot("06-ship")

  // Several stock locations: the form asks where the goods leave from (stubbed list, the dev shop has one).
  await page.route("**/admin/shipping-options/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }))
  await page.route("**/admin/stock-locations?*", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stock_locations: [{ id: "sloc_a", name: "Lager Wien" }, { id: "sloc_b", name: "Lager Graz" }] }) }))
  await page.goto("ship")
  await page.getByLabel("Versand ab").waitFor()
  await shot("06b-ship-locations")
  await page.unroute("**/admin/shipping-options/**")
  await page.unroute("**/admin/stock-locations?*")

  // Lost connection while shipping: the text says it is not known whether the shipment exists.
  await page.route("**/admin/medusify/orders/*/ship", (r) => r.abort("connectionfailed"))
  await page.goto("ship")
  await page.getByLabel("Sendungsnummer (optional)", { exact: true }).fill("RR000000000AT")
  await page.getByRole("button", { name: "Als versendet markieren" }).click()
  await page.getByText("Keine Antwort vom Shop").waitFor()
  await shot("06c-ship-no-answer")
  await page.unroute("**/admin/medusify/orders/*/ship")

  await page.goto("more")
  await page.getByRole("heading", { name: "Mehr" }).first().waitFor()
  await shot("07-more")

  await page.goto("more/add")
  await page.waitForTimeout(300)
  await shot("08-add-shop")
  await page.goto("offline.html")
  await page.getByRole("heading", { name: "Keine Verbindung" }).waitFor()
  await shot("09-offline")

  // Signing out while the shop cannot end the session: the login screen says so.
  await page.route("**/auth/session", (r) => (r.request().method() === "DELETE" ? r.abort("connectionfailed") : r.continue()))
  await page.goto("more")
  await page.getByRole("heading", { name: "Mehr" }).first().waitFor()
  await page.getByRole("button", { name: "Abmelden" }).click()
  await page.getByText("Die Sitzung im Shop konnte nicht beendet werden").waitFor()
  await shot("10-logout-session-open")
  await context.close()
}
await browser.close()
writeFileSync(join(out, "overflow-check.json"), JSON.stringify(log, null, 2) + "\n")
for (const l of log) console.log(`${l.ok ? "ok  " : "FAIL"} ${l.shot.padEnd(26)} scrollWidth=${l.scrollWidth} innerWidth=${l.innerWidth} gutter=${l.gutter}`)
if (log.some((l) => !l.ok)) process.exit(1)
