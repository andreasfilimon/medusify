const crypto = require("node:crypto")
const { MetadataStorage } = require("@medusajs/framework/mikro-orm/core")

MetadataStorage.clear()

// VAPID test keys are generated at runtime on every run — nothing key-like is ever committed.
if (!process.env.MEDUSIFY_VAPID_PUBLIC_KEY) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  const pub = publicKey.export({ format: "jwk" })
  const priv = privateKey.export({ format: "jwk" })
  const b64u = (s) => Buffer.from(s, "base64url")
  process.env.MEDUSIFY_VAPID_PUBLIC_KEY = Buffer.concat([
    Buffer.from([4]),
    b64u(pub.x),
    b64u(pub.y),
  ]).toString("base64url")
  process.env.MEDUSIFY_VAPID_PRIVATE_KEY = priv.d
  process.env.MEDUSIFY_VAPID_SUBJECT = "mailto:test@example.invalid"
}
