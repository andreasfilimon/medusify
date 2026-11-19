import crypto from "node:crypto"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { hasMedusaRbac } from "./medusa-version"

/**
 * Medusa's RBAC module only loads with a license signed by Medusa. The public key it checks against can be replaced by
 * `MEDUSA_LICENSE_PUBLIC_KEY` (utils/dist/license). So the RBAC spec signs a license for the feature `rbac` with a
 * key pair it creates on every run. Nothing key-like is committed and the license is worthless anywhere else.
 */
export function useThrowAwayRbacLicense() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const head = segment({ alg: "EdDSA", typ: "JWT" })
  const body = segment({ sub: "medusify-integration-test", features: ["rbac"] })
  const signature = crypto.sign(null, Buffer.from(`${head}.${body}`), privateKey).toString("base64url")
  process.env.MEDUSA_LICENSE_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString()
  process.env.MEDUSA_LICENSE_KEY = `${head}.${body}.${signature}`
  process.env.MEDUSIFY_TEST_RBAC = "1"
}

/**
 * `medusaIntegrationTestRunner` for specs that need Medusa's RBAC module. It sets the throw-away license before the runner
 * loads medusa-config.ts. Medusa 2.22.0 to 2.22.2 have no RBAC module (the plugin then lets every admin through), so
 * there the spec is skipped, and the CI matrix can run the whole suite on those versions.
 */
export function rbacRunner(): typeof medusaIntegrationTestRunner {
  if (!hasMedusaRbac()) {
    return (() =>
      describe.skip("needs Medusa 2.22.3 or newer (roles)", () => it("is skipped on this Medusa version", () => {}))) as never
  }
  useThrowAwayRbacLicense()
  return medusaIntegrationTestRunner
}
