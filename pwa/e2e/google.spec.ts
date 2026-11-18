import { expect, test } from "@playwright/test"
import { BASE } from "./helpers"

// The dev shop runs a stand-in for Google (dev-shop/src/modules/fake-google): same redirect protocol, no Google project.
// The admin user is linked to the stand-in identity "fake-sub-admin@devshop.invalid" (src/scripts/link-fake-google.ts).

const signedIn = async (page: import("@playwright/test").Page) => (await page.request.get(`${BASE}/admin/users/me`)).status() === 200

// The service worker would hide requests from page.route; it plays no role in the sign-in.
test.use({ serviceWorkers: "block" })

test.describe("Google sign-in", () => {
  test("shows Google and the password form together", async ({ page }) => {
    await page.goto("")
    await expect(page.getByRole("button", { name: "Mit Google anmelden" })).toBeVisible()
    await expect(page.getByLabel("E-Mail")).toBeVisible()
    await expect(page.getByText("oder", { exact: true })).toBeVisible()
  })

  test("signs in through Google without a code step, and leaves no code in the address bar", async ({ page }) => {
    await page.goto("")
    await page.getByRole("button", { name: "Mit Google anmelden" }).click()
    await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()
    expect(page.url()).not.toContain("code=")
    expect(page.url()).not.toContain("state=")
    expect(await signedIn(page)).toBe(true)
  })

  test("an account the shop does not know gets no session", async ({ page }) => {
    await page.route("**/auth/user/google", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}") as object
      await route.continue({ postData: JSON.stringify({ ...body, fake_account: "stranger@example.invalid" }) })
    })
    await page.goto("")
    await page.getByRole("button", { name: "Mit Google anmelden" }).click()
    await expect(page.getByText("keinen Zugang")).toBeVisible()
    await expect(page.getByRole("button", { name: "Mit Google anmelden" })).toBeVisible()
    expect(await signedIn(page)).toBe(false)
  })

  test("a callback this browser did not start is refused", async ({ page }) => {
    await page.goto("auth/google?code=fake%3Aadmin%40devshop.invalid&state=not-ours")
    await expect(page.getByText("nicht möglich")).toBeVisible()
    expect(page.url()).not.toContain("code=")
    expect(await signedIn(page)).toBe(false)
  })

  test("cancelling at Google shows a calm message", async ({ page }) => {
    await page.goto("auth/google?error=access_denied")
    await expect(page.getByText("abgebrochen")).toBeVisible()
    expect(await signedIn(page)).toBe(false)
  })
})
