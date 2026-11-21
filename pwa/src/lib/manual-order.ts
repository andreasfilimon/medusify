import type { VariantView } from "./catalog"

/** What the plugin offers for an order by hand (GET /admin/medusify/orders/setup, plugin 0.4.0). */
export type OrderSetup = {
  regions: { id: string; name: string; currency_code: string; countries: { iso_2: string; name: string }[] }[]
  shipping_options: { id: string; name: string; prices: Record<string, number | null> }[]
}

export type ManualLine = {
  variant_id: string
  title: string
  /** The variant's own name, empty for the single variant of a simple product. */
  variant: string
  /** The plain catalog price in the region's currency; null when the variant has none there. */
  unit: number | null
  /** At most this many: the stock, when the shop tracks it and does not sell beyond it. */
  max: number | null
  quantity: number
}

export type ManualAddress = { first_name: string; last_name: string; company: string; address_1: string; postal_code: string; city: string; country_code: string; phone: string }
export const EMPTY_ADDRESS: ManualAddress = { first_name: "", last_name: "", company: "", address_1: "", postal_code: "", city: "", country_code: "", phone: "" }

/** The plain price of the variant in the currency (no rule, no tier): what the shop charges unless a price list applies. */
export function unitPrice(variant: Pick<VariantView, "prices">, currency: string): number | null {
  return variant.prices.find((p) => p.base && p.currency_code.toLowerCase() === currency.toLowerCase())?.amount ?? null
}

/** The most that can be ordered: the sellable stock when the shop tracks it and allows no backorder. */
export function lineMax(variant: Pick<VariantView, "manage_inventory" | "allow_backorder" | "stock_total">): number | null {
  return variant.manage_inventory && !variant.allow_backorder && variant.stock_total !== null ? Math.max(0, variant.stock_total) : null
}

/** Adds one unit of a variant: a new line, or one more on its line, never beyond the stock. */
export function addLine(lines: readonly ManualLine[], line: Omit<ManualLine, "quantity">): ManualLine[] {
  const at = lines.findIndex((l) => l.variant_id === line.variant_id)
  if (at < 0) return line.max === 0 ? [...lines] : [...lines, { ...line, quantity: 1 }]
  return lines.map((l, i) => (i === at ? { ...l, quantity: l.max === null ? l.quantity + 1 : Math.min(l.max, l.quantity + 1) } : l))
}

/** Sets the count of a line; 0 takes the line out. */
export function setQuantity(lines: readonly ManualLine[], variantId: string, quantity: number): ManualLine[] {
  if (quantity <= 0) return lines.filter((l) => l.variant_id !== variantId)
  return lines.map((l) => (l.variant_id === variantId ? { ...l, quantity: l.max === null ? quantity : Math.min(l.max, quantity) } : l))
}

/**
 * The sum the form shows before the order exists, in minor units to avoid float drift. `complete` is false when a line
 * has no price in this currency: the shop prices it, the form cannot.
 */
export function estimate(lines: readonly ManualLine[], shipping: number | null, digits = 2): { items: number; total: number; complete: boolean } {
  const f = 10 ** digits
  const items = lines.reduce((s, l) => s + Math.round((l.unit ?? 0) * f) * l.quantity, 0)
  const ship = Math.round((shipping ?? 0) * f)
  return { items: items / f, total: (items + ship) / f, complete: lines.every((l) => l.unit !== null) }
}

/** A plausible address: one @, something before it, a dot in the domain, no spaces. The shop checks it again. */
export const isEmail = (raw: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.trim())

export type AddressCheck = { ok: true; address: ManualAddress | null } | { ok: false; missing: (keyof ManualAddress)[] }

/** No address at all is fine (pick-up); a started one needs street, postcode, town and country, and a name or company. */
export function checkAddress(a: ManualAddress): AddressCheck {
  const v = Object.fromEntries(Object.entries(a).map(([k, x]) => [k, x.trim()])) as ManualAddress
  if (Object.values(v).every((x) => x === "")) return { ok: true, address: null }
  const missing = (["address_1", "postal_code", "city", "country_code"] as const).filter((k) => v[k] === "")
  const named = v.first_name || v.last_name || v.company
  const all: (keyof ManualAddress)[] = named ? [...missing] : ["last_name", ...missing]
  return all.length ? { ok: false, missing: all } : { ok: true, address: v }
}

export type ManualOrderInput = {
  region_id: string
  customer_id: string | null
  email: string | null
  items: { variant_id: string; quantity: number }[]
  shipping_option_id: string | null
  shipping_address: Partial<ManualAddress> | null
  paid: boolean
  idempotency_key: string
}

/** The body for the plugin: empty address fields are left out, the country in lower case. */
export function manualOrderBody(input: Omit<ManualOrderInput, "shipping_address"> & { address: ManualAddress | null }): ManualOrderInput {
  const { address, ...rest } = input
  const shipping_address = address
    ? (Object.fromEntries(Object.entries(address).filter(([, x]) => x.trim() !== "").map(([k, x]) => [k, k === "country_code" ? x.trim().toLowerCase() : x.trim()])) as Partial<ManualAddress>)
    : null
  return { ...rest, shipping_address }
}
