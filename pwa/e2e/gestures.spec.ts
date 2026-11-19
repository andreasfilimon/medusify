import { expect, test, type Page } from "@playwright/test"

// Touch gestures and transitions in a real browser with real touch events (CDP). Chromium only: WebKit on Linux has no touch
// injection and draws no backdrop blur. Against the dev shop's demo orders.

async function signIn(page: Page) {
  await page.goto("")
  await page.getByRole("button", { name: "Mit Google anmelden" }).click()
  await page.getByRole("heading", { name: "Start" }).first().waitFor()
}

/** A finger drag with real timing, so speed and direction reach the page as in use. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] })
  for (let i = 1; i <= steps; i++) {
    await page.waitForTimeout(16)
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }] })
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}

const frontX = (page: Page, row: ReturnType<Page["locator"]>) =>
  row.locator(".front").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)

test("swiping a row to the left shows its action, tapping it opens the confirmation on the detail page", async ({ page }) => {
  await signIn(page)
  await page.goto("orders")
  const row = page.locator(".swipe", { hasText: "Zu versenden" }).first()
  await row.waitFor()
  const box = (await row.boundingBox())!
  await drag(page, { x: box.x + box.width - 40, y: box.y + box.height / 2 }, { x: box.x + 40, y: box.y + box.height / 2 })
  await expect.poll(() => frontX(page, row)).toBeCloseTo(-96, 0)
  // a swipe is not a tap: the order did not open
  expect(page.url()).not.toContain("/orders/")
  await row.getByRole("button", { name: "Versenden" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await expect(page).toHaveURL(/\/orders\/[^?]+\?shop=[^&]+$/) // ?do=ship is gone again
})

test("a short pull springs back, vertical scrolling never moves a row, an open row closes on tap", async ({ page }) => {
  await signIn(page)
  await page.goto("orders")
  const row = page.locator(".swipe", { hasText: "Zu versenden" }).first()
  await row.waitFor()
  const box = (await row.boundingBox())!
  const y = box.y + box.height / 2
  await drag(page, { x: box.x + 300, y }, { x: box.x + 270, y }) // 30 px: less than half
  await expect.poll(() => frontX(page, row)).toBeCloseTo(0, 0)
  await drag(page, { x: box.x + 200, y }, { x: box.x + 190, y: y - 120 }) // mostly vertical
  expect(await frontX(page, row)).toBeCloseTo(0, 0)
  const again = (await row.boundingBox())!
  await drag(page, { x: again.x + 340, y: again.y + again.height / 2 }, { x: again.x + 60, y: again.y + again.height / 2 })
  await expect.poll(() => frontX(page, row)).toBeCloseTo(-96, 0)
  const open = (await row.boundingBox())!
  await page.touchscreen.tap(open.x + 40, open.y + open.height / 2) // a tap on the open row closes it
  await expect.poll(() => frontX(page, row)).toBeCloseTo(0, 0)
  expect(page.url()).not.toContain("/orders/order")
})

test("opening an order runs a view transition with the order title as the shared element, going back reverses it", async ({ page }) => {
  await signIn(page)
  await page.goto("orders")
  await page.locator("a.row").first().waitFor()
  await page.evaluate(() => {
    const w = window as unknown as { __vt: { kind: string | undefined; names: string[] }[] }
    w.__vt = []
    const orig = document.startViewTransition.bind(document)
    document.startViewTransition = (cb) => {
      const kind = document.documentElement.dataset.vt
      const t = orig(cb)
      void t.ready.then(() => w.__vt.push({ kind, names: document.getAnimations().map((a) => (a.effect as KeyframeEffect).pseudoElement ?? "") })).catch(() => {})
      return t
    }
  })
  await page.locator("a.row").first().click()
  await page.getByText("Kunde und Lieferung").waitFor()
  await page.getByRole("button", { name: "Bestellungen" }).click()
  await page.locator("a.row").first().waitFor()
  const read = () => page.evaluate(() => (window as unknown as { __vt: { kind: string; names: string[] }[] }).__vt)
  await expect.poll(async () => (await read()).length).toBe(2)
  const seen = await read()
  expect(seen.map((s) => s.kind)).toEqual(["forward", "back"])
  for (const s of seen) expect(s.names).toContain("::view-transition-group(order-title)")
})

test("a mouse drag over a row swipes it and does not open the order", async ({ page }) => {
  await signIn(page)
  await page.goto("orders")
  const row = page.locator(".swipe", { hasText: "Zu versenden" }).first()
  await row.waitFor()
  const box = (await row.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 320, y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + 320 - i * 30, y)
  await page.mouse.up()
  await expect.poll(() => frontX(page, row)).toBeCloseTo(-96, 0)
  expect(page.url()).not.toContain("/orders/")
})

async function openRefundSheet(page: Page) {
  await signIn(page)
  await page.goto("orders")
  await page.locator("a.row", { hasText: "Rita" }).first().click()
  await page.getByText("Kunde und Lieferung").waitFor()
  await page.getByText("Erstatten").first().click()
  await page.getByRole("dialog").waitFor()
  await page.waitForTimeout(700) // the opening spring
}

test("pulling a sheet down by its head closes it, a short pull springs back", async ({ page }) => {
  await openRefundSheet(page)
  const head = (await page.locator(".sheet .sheet-head").boundingBox())!
  const x = head.x + head.width / 2
  // 20 px, let go: back in its place, still open
  await drag(page, { x, y: head.y + 20 }, { x, y: head.y + 40 }, 8)
  await expect.poll(() => page.locator(".sheet").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeCloseTo(0, 0)
  await expect(page.getByRole("dialog")).toBeVisible()
  // a long pull down: gone
  await drag(page, { x, y: head.y + 20 }, { x, y: head.y + 150 }, 10)
  await expect(page.getByRole("dialog")).toBeHidden()
})

test("a refund that is being sent cannot be pulled away, the dialog stays until the shop answers", async ({ page }) => {
  // The refund request never leaves the browser: nothing is refunded, the sheet stays locked while it "sends".
  await page.route("**/refund", () => {})
  await openRefundSheet(page)
  await page.getByLabel(/Betrag in EUR/).fill("1")
  await page.getByRole("button", { name: "Weiter" }).click()
  await page.getByRole("button", { name: /erstatten$/ }).click()
  await expect(page.getByRole("button", { name: "Abbrechen" })).toBeDisabled() // locked
  const head = (await page.locator(".sheet .sheet-head").boundingBox())!
  const x = head.x + head.width / 2
  await drag(page, { x, y: head.y + 20 }, { x, y: 840 }, 14) // all the way down: an unlocked sheet would leave
  await page.waitForTimeout(900)
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toBeVisible()
})

// Playwright cannot switch the display mode, so the installed mode is faked for the page's own query.
async function asInstalledApp(page: Page) {
  await page.addInitScript(() => {
    const orig = window.matchMedia.bind(window)
    window.matchMedia = (q: string) => (q.includes("display-mode: standalone") ? ({ ...orig("(min-width: 0px)"), matches: true, media: q } as MediaQueryList) : orig(q))
  })
}

test("in the installed app a swipe from the left edge goes back one page", async ({ page }) => {
  await asInstalledApp(page)
  await signIn(page)
  await page.goto("orders")
  await page.locator("a.row").first().click()
  await page.getByText("Kunde und Lieferung").waitFor()
  await page.waitForTimeout(500)
  await drag(page, { x: 6, y: 400 }, { x: 160, y: 410 }, 10)
  await expect(page).toHaveURL(/\/orders(\?|$)/)
  await expect(page.getByText("Kunde und Lieferung")).toHaveCount(0)
})

test("a swipe that does not start at the edge, is too short or too steep does not go back", async ({ page }) => {
  await asInstalledApp(page)
  await signIn(page)
  await page.goto("orders")
  await page.locator("a.row").first().click()
  await page.getByText("Kunde und Lieferung").waitFor()
  await page.waitForTimeout(500)
  await drag(page, { x: 80, y: 400 }, { x: 240, y: 410 }, 10) // not from the edge
  await drag(page, { x: 6, y: 400 }, { x: 50, y: 405 }, 10) // too short
  await drag(page, { x: 6, y: 300 }, { x: 100, y: 600 }, 10) // mostly vertical
  await expect(page.getByText("Kunde und Lieferung")).toBeVisible()
})

test("in a browser tab the edge swipe does nothing: the browser has its own", async ({ page }) => {
  await signIn(page)
  await page.goto("orders")
  await page.locator("a.row").first().click()
  await page.getByText("Kunde und Lieferung").waitFor()
  await page.waitForTimeout(500)
  await drag(page, { x: 6, y: 400 }, { x: 160, y: 410 }, 10)
  await expect(page.getByText("Kunde und Lieferung")).toBeVisible()
})

test.describe("reduced motion", () => {
  test("pages change without a view transition", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await signIn(page)
    await page.goto("orders")
    await page.locator("a.row").first().waitFor()
    await page.evaluate(() => {
      const w = window as unknown as { __vt: number }
      w.__vt = 0
      const orig = document.startViewTransition.bind(document)
      document.startViewTransition = (cb) => { w.__vt++; return orig(cb) }
    })
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true)
    await page.locator("a.row").first().click()
    await page.getByText("Kunde und Lieferung").waitFor()
    expect(await page.evaluate(() => (window as unknown as { __vt: number }).__vt)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-sda"))).toBe(false)
  })
})
