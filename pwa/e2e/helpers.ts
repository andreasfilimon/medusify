import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, type Page } from "@playwright/test"
// @ts-expect-error plain JS helper of the dev shop (demo data only)
import { totp } from "../../dev-shop/scripts/totp.mjs"

const shopDir = join(import.meta.dirname, "../../dev-shop")

export const BASE = process.env.E2E_BASE ?? "http://localhost:9055"
export const ADMIN = "admin@devshop.invalid"

function envValue(name: string): string {
  const line = readFileSync(join(shopDir, ".env"), "utf8").split("\n").find((l) => l.startsWith(`${name}=`))
  if (!line) throw new Error(`${name} missing in dev-shop/.env`)
  return line.slice(name.length + 1).trim()
}
export const adminPassword = () => envValue("DEVSHOP_ADMIN_PASSWORD")
export const mfaSecret = () => readFileSync(join(shopDir, ".devshop-mfa"), "utf8").trim()

/** Waits for the start of the next 30 s TOTP window so a code is never reused. */
export async function freshTotp(): Promise<string> {
  const msIntoWindow = Date.now() % 30_000
  if (msIntoWindow > 24_000) await new Promise((r) => setTimeout(r, 30_000 - msIntoWindow + 300))
  return totp(mfaSecret())
}

/** Admin API token for assertions on the server side (never used by the app under test). */
export async function adminToken(): Promise<string> {
  const post = (path: string, body: unknown, h: Record<string, string> = {}) =>
    fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) })
  const first = (await (await post("/auth/user/emailpass", { email: ADMIN, password: adminPassword() })).json()) as { token: string; mfa_challenge?: { id: string } }
  if (!first.mfa_challenge) return first.token
  const res = await post(`/auth/mfa/challenges/${first.mfa_challenge.id}/verify`, { method: "totp", code: await freshTotp() }, { authorization: `Bearer ${first.token}` })
  return ((await res.json()) as { token: string }).token
}

export async function toShipCount(token: string): Promise<number> {
  const res = await fetch(`${BASE}/admin/medusify/dashboard`, { headers: { authorization: `Bearer ${token}` } })
  return ((await res.json()) as { to_ship: number }).to_ship
}

export async function signInWithPassword(page: Page) {
  await page.goto("")
  await page.getByLabel("E-Mail").fill(ADMIN)
  await page.getByLabel("Passwort", { exact: true }).fill(adminPassword())
  await page.getByRole("button", { name: "Anmelden", exact: true }).click()
  await page.getByLabel("6-stelliger Code").fill(await freshTotp())
  await page.getByRole("button", { name: "Bestätigen", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Start" }).first()).toBeVisible()
}

/** The most recently shipped fulfillments as Medusa stores them (L1: the shipment really exists, with its tracking number). */
export async function lastShippedTracking(token: string): Promise<string[]> {
  const fields = encodeURIComponent("id,fulfillments.shipped_at,fulfillments.canceled_at,fulfillments.labels.tracking_number")
  const res = await fetch(`${BASE}/admin/orders?fulfillment_status=shipped&order=-updated_at&limit=5&fields=${fields}`, { headers: { authorization: `Bearer ${token}` } })
  const body = (await res.json()) as { orders: { fulfillments?: { shipped_at?: string | null; canceled_at?: string | null; labels?: { tracking_number?: string }[] }[] }[] }
  return body.orders.flatMap((o) => (o.fulfillments ?? []).filter((f) => f.shipped_at && !f.canceled_at).flatMap((f) => (f.labels ?? []).map((l) => l.tracking_number ?? "")))
}
