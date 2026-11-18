// Prints a fresh admin bearer token for the dev shop (logs in with MFA). Demo data only.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { totp } from "./totp.mjs"

const BASE = process.env.BASE ?? "http://localhost:9055"
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const secret = readFileSync(join(root, ".devshop-mfa"), "utf8").trim()
const post = (p, body, h = {}) =>
  fetch(BASE + p, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) })

export async function devshopToken() {
  const first = await (await post("/auth/user/emailpass", { email: "admin@devshop.invalid", password: process.env.DEVSHOP_ADMIN_PASSWORD })).json()
  if (!first.mfa_challenge) return first.token
  const res = await post(`/auth/mfa/challenges/${first.mfa_challenge.id}/verify`, { method: "totp", code: totp(secret) }, { authorization: `Bearer ${first.token}` })
  if (!res.ok) throw new Error(`mfa verify failed: ${res.status}`)
  return (await res.json()).token
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(await devshopToken())
