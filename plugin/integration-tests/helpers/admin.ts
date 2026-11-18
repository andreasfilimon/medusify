import { Modules } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import jwt from "jsonwebtoken"

/** Creates an admin user and returns request options with a bearer token (secret = medusa-config jwtSecret). */
export async function createAdmin(container: MedusaContainer, email = "admin@example.invalid") {
  const userModule = container.resolve(Modules.USER)
  const authModule = container.resolve(Modules.AUTH)
  const user = await userModule.createUsers({ email })
  const authIdentity = await authModule.createAuthIdentities({
    provider_identities: [{ provider: "emailpass", entity_id: email, provider_metadata: { password: "x" } }],
    app_metadata: { user_id: user.id },
  })
  const token = jwt.sign(
    { actor_id: user.id, actor_type: "user", auth_identity_id: authIdentity.id },
    process.env.JWT_SECRET || "supersecret",
    { expiresIn: "1d" }
  )
  return { userId: user.id, headers: { authorization: `Bearer ${token}` } }
}

export const sub = (n: number, extra: Record<string, unknown> = {}) => ({
  endpoint: `https://push.example.invalid/send/${n}`,
  keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" },
  ...extra,
})
