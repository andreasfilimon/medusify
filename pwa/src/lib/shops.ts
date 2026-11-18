import type { Shop, ShopColor } from "./types"

const LOOPBACK = new Set(["localhost", "127.0.0.1"])

export type NormalizeResult = { ok: true; origin: string } | { ok: false; reason: "empty" | "invalid" | "insecure" }

/** Accepts "shop.example.com", "https://shop.example.com/admin" and returns the origin. http only on loopback. */
export function normalizeShopUrl(raw: string): NormalizeResult {
  const text = raw.trim()
  if (!text) return { ok: false, reason: "empty" }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, reason: "invalid" }
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "invalid" }
  if (!url.hostname) return { ok: false, reason: "invalid" }
  const loopback = LOOPBACK.has(url.hostname) || url.hostname.endsWith(".localhost")
  if (url.protocol === "http:" && !loopback) return { ok: false, reason: "insecure" }
  return { ok: true, origin: url.origin }
}

/**
 * The id is the normalised origin ("https://shop.example.com", "http://localhost:9055"). Two different origins can
 * never share an id, unlike the first version that replaced punctuation ("a.b.com" and "a-b.com" collided).
 */
export function shopIdFromOrigin(origin: string): string {
  return new URL(origin).origin
}

/** The id format of the first version. Only used to recognise shops saved before the change. */
export function legacyShopId(origin: string): string {
  const url = new URL(origin)
  return `${url.hostname}${url.port ? `-${url.port}` : ""}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase()
}

/** First free colour in order of adding; wraps once all six are taken. */
export function nextColor(shops: Pick<Shop, "color">[]): ShopColor {
  const used = new Set(shops.map((s) => s.color))
  for (const c of [1, 2, 3, 4, 5, 6] as ShopColor[]) if (!used.has(c)) return c
  return ((shops.length % 6) + 1) as ShopColor
}

export function monogram(name: string): string {
  const letter = name.trim().match(/\p{L}|\p{N}/u)?.[0] ?? "?"
  return letter.toUpperCase()
}

export function defaultShopName(origin: string): string {
  return new URL(origin).hostname.replace(/^www\./, "")
}

/** Adds or replaces a shop (same id). The home shop is always first. */
export function upsertShop(shops: Shop[], shop: Shop): Shop[] {
  const rest = shops.filter((s) => s.id !== shop.id)
  const next = [...rest, shop]
  return next.sort((a, b) => Number(b.home) - Number(a.home))
}

export function removeShop(shops: Shop[], id: string): Shop[] {
  return shops.filter((s) => s.id !== id)
}

/** The scope is "all" or one shop id that still exists. */
export function resolveScope(shops: Shop[], scope: string | null): string {
  if (!scope || scope === "all") return "all"
  return shops.some((s) => s.id === scope) ? scope : "all"
}

export function scopedShops(shops: Shop[], scope: string): Shop[] {
  return scope === "all" ? shops : shops.filter((s) => s.id === scope)
}
