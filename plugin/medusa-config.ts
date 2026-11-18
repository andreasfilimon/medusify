/**
 * Only used by the plugin's own integration tests and `db:generate` (not shipped, see package.json `files`).
 * A merchant registers the plugin in THEIR medusa-config.ts, see README.md.
 */
import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: "http://localhost:8000",
      adminCors: "http://localhost:9000",
      authCors: "http://localhost:9000",
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    },
  },
  modules: [
    // Medusa's RBAC module is licensed (MEDUSA_LICENSE_KEY). Only the RBAC spec loads it, with a throw-away license
    // it signs itself (integration-tests/helpers/rbac-license.ts); every other spec runs the shop without roles.
    ...(process.env.MEDUSIFY_TEST_RBAC ? [{ resolve: "@medusajs/medusa/rbac" }] : []),
    {
      resolve: "./src/modules/medusify-push",
      options: {
        vapid: {
          publicKey: process.env.MEDUSIFY_VAPID_PUBLIC_KEY,
          privateKey: process.env.MEDUSIFY_VAPID_PRIVATE_KEY,
          subject: process.env.MEDUSIFY_VAPID_SUBJECT,
        },
        storeLabel: process.env.MEDUSIFY_STORE_LABEL || "Testshop",
        locale: process.env.MEDUSIFY_LOCALE || "de",
        pwaDir: process.env.MEDUSIFY_PWA_DIR || undefined,
      },
    },
  ],
})
