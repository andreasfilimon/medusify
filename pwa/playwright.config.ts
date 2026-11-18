import { defineConfig, devices } from "@playwright/test"

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
    { name: "webkit", testMatch: /(app|google|csp|kit)\.spec\.ts/, use: { ...devices["iPhone 15"] } },
    {
      name: "chromium",
      testMatch: /(sw|push|csp)\.spec\.ts/,
      // A fake camera, so the barcode scanner starts without a device.
      use: {
        ...devices["Pixel 7"],
        channel: "chromium",
        permissions: ["camera"],
        launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
      },
    },
  ],
})
