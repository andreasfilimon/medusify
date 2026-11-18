#!/usr/bin/env node
// Enrolls TOTP for the dev-shop admin and stores the secret in .devshop-mfa (gitignored). Demo data only.
//   BASE=http://localhost:9055 EMAIL=admin@devshop.invalid PASSWORD=... node scripts/enroll-mfa.mjs
import { existsSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { totp } from "./totp.mjs"

const BASE = process.env.BASE ?? "http://localhost:9055"
const EMAIL = process.env.EMAIL ?? "admin@devshop.invalid"
const PASSWORD = process.env.PASSWORD
if (!PASSWORD) {
  console.error("PASSWORD is required")
  process.exit(2)
}
const out = join(dirname(fileURLToPath(import.meta.url)), "..", ".devshop-mfa")
if (existsSync(out)) {
  console.log(`${out} exists, MFA is already enrolled`)
  process.exit(0)
}

async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...init.headers } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(body)}`)
  return body
}

const { token } = await call("/auth/user/emailpass", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })
const auth = { authorization: `Bearer ${token}` }
const setup = await call("/auth/mfa/factors", {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ provider: "totp", label: "Dev shop", issuer: "Medusify dev shop" }),
})
await call(`/auth/mfa/factors/${setup.mfa_factor.id}/verify`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ code: totp(setup.secret) }),
})
writeFileSync(out, `${setup.secret}\n`, { mode: 0o600 })
console.log("MFA enrolled, secret written to .devshop-mfa")
