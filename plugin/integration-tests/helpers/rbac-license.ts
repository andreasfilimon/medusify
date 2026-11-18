import crypto from "node:crypto"

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
