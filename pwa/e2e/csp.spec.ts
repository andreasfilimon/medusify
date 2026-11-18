import { expect, test } from "@playwright/test"
import { BASE } from "./helpers"

/**
 * The plugin serves the app with a Content-Security-Policy. This runs the real app under it and fails on any violation:
 * a `securitypolicyviolation` event, a CSP message in the console, or a page error. The journey covers what the policy
 * could break: the scripts and styles of the app, the service worker, API calls to the shop, the offline page and the
 * barcode decoder (WebAssembly, which is why script-src has 'wasm-unsafe-eval').
 */
type Seen = { violations: string[]; console: string[]; pageErrors: string[] }

test("the app works under its Content-Security-Policy without a single violation", async ({ page, context, browserName }) => {
  const seen: Seen = { violations: [], console: [], pageErrors: [] }
  await context.addInitScript(() => {
    const w = window as unknown as { __csp: string[] }
    w.__csp = []
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`))
  })
  page.on("console", (m) => {
    if (/content security policy|refused to|violates the following/i.test(m.text())) seen.console.push(m.text())
  })
  page.on("pageerror", (e) => seen.pageErrors.push(e.message))
  const drain = async () => seen.violations.push(...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.splice(0))))

  // The header is really there. Medusa adds its own `frame-ancestors 'self'` to everything, so check for the app's.
  const head = await page.request.get(`${BASE}/medusify/`)
  expect(head.headers()["content-security-policy"]).toContain("script-src 'self' 'wasm-unsafe-eval'")

  // Positive control: an inline script must be refused and reported, or "no violations" below would prove nothing.
  await page.goto("")
  await page.addScriptTag({ content: "window.__injected = true" }).catch(() => undefined)
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp.length))).toBeGreaterThan(0)
  expect(await page.evaluate(() => "__injected" in window)).toBe(false)
  expect(seen.console.some((m) => /script-src/.test(m))).toBe(true)
  await drain()
  seen.violations.length = 0
  seen.console.length = 0

  // The journey, under the policy.
  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).click()
  await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()
  await page.evaluate(async () => (await navigator.serviceWorker.ready).scope)
  await page.goto("orders")
  await expect(page.getByRole("heading", { name: "Bestellungen" }).first()).toBeVisible()
  await page.locator("a.row").first().click()
  await expect(page.getByText("Kunde und Lieferung")).toBeVisible()
  await page.goto("")
  await page.getByRole("link", { name: "Versand starten" }).click()

  // The barcode decoder: its .wasm file has to load and compile, and the camera has to start. Chromium only, because
  // WebKit has no fake camera. The WebKit run covers the rest of the journey.
  if (browserName === "chromium") {
    const wasm = await page.waitForResponse((r) => /zxing_reader.*\.wasm$/.test(r.url()), { timeout: 20_000 })
    expect(wasm.status()).toBe(200)
    await expect(page.locator("video")).toBeVisible()
    await page.waitForTimeout(2000) // a few decode frames run
    await expect(page.getByText("Kamera ist aus.")).toHaveCount(0)
  }

  // The offline page (its one inline style is allowed by hash).
  const offline = await page.request.get(`${BASE}/medusify/offline.html`)
  expect(offline.headers()["content-security-policy"]).toMatch(/style-src 'self' 'sha256-[A-Za-z0-9+/=]+'/)

  await drain()
  expect({ violations: seen.violations, console: seen.console, pageErrors: seen.pageErrors }).toEqual({ violations: [], console: [], pageErrors: [] })
})
