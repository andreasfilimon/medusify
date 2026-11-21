import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { defineConfig, devices } from "@playwright/test"

// The fake camera clip of the scanner E2E: an EAN-13 from the in-store range, drawn by e2e/fixtures/make-ean13.py (not committed, 5 MB).
const ean = join(import.meta.dirname, "e2e/fixtures/ean13.y4m")
if (!existsSync(ean)) execFileSync("python3", [join(import.meta.dirname, "e2e/fixtures/make-ean13.py"), "2000000000008", ean])

// Runs against the dev shop (http://localhost:9055) that serves the production build under /medusify.
// iPhone 15 profile in WebKit for the screens, Chromium for the service worker and push checks. The CSP spec runs in both.
const base = process.env.E2E_BASE ?? "http://localhost:9055"
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  outputDir: "test-results",
  use: { baseURL: `${base}/medusify/`, locale: "de-AT", timezoneId: "Europe/Vienna", trace: "retain-on-failure" },
  projects: [
    { name: "webkit", testMatch: /(app|actions|lost-answer|google|csp|kit|catalog|customers|discounts|manual-order|order-change)\.spec\.ts/, use: { ...devices["iPhone 15"] } },
    {
      name: "chromium",
      testMatch: /(sw|push|csp|gestures)\.spec\.ts/,
      // A fake camera, so the barcode scanner starts without a device.
      use: {
        ...devices["Pixel 7"],
        channel: "chromium",
        permissions: ["camera"],
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
    {
      name: "chromium-scan",
      testMatch: /catalog-scan\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        channel: "chromium",
        permissions: ["camera"],
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${ean}`] },
      },
    },
  ],
})
