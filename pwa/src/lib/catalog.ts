/**
 * What the app shows of the catalog. The shapes are the ones the plugin's catalog routes answer with
 * (plugin/src/lib/catalog.ts); the numbers are computed in the plugin, the app only formats and decides what can be done.
 */

export type PriceView = { id: string; currency_code: string; amount: number; /** A plain price: no rule and no quantity tier. Only these can be changed here. */ base: boolean }

export type LevelView = { location_id: string; location_name: string; stocked: number; reserved: number; available: number; incoming: number }

export type InventoryView = { inventory_item_id: string; required_quantity: number; levels: LevelView[] }

export type MatchField = "barcode" | "sku" | "ean" | "upc"

export type VariantView = {
  id: string
  title: string
  sku: string | null
  barcode: string | null
  ean: string | null
  upc: string | null
  manage_inventory: boolean
  allow_backorder: boolean
  prices: PriceView[]
  inventory: InventoryView[]
  /** Units that can be sold over all locations; null when the variant does not track stock. */
  stock_total: number | null
  /** One inventory item, one unit per variant unit: the app may count it. */
  stock_editable: boolean
  /** The role may not read stock: no levels and no total, though the shop may track it (plugin 0.3.0; missing on older answers). */
  stock_hidden?: boolean
}

export type ProductView = { id: string; title: string; status: string; thumbnail: string | null; variants: VariantView[] }

export type ProductPage = { products: ProductView[]; count: number; offset: number; limit: number }

export type LookupMatch = { product: Omit<ProductView, "variants">; variant: VariantView; matched_by: MatchField }

/** The most that fits in the number field of a count: the same bound the plugin checks. */
export const MAX_STOCK = 1_000_000

/** Units that can be sold of a product over its variants; null when none of its variants tracks stock. */
export function productStock(product: Pick<ProductView, "variants">): number | null {
  const tracked = product.variants.filter((v) => v.stock_total !== null)
  return tracked.length === 0 ? null : tracked.reduce((sum, v) => sum + (v.stock_total ?? 0), 0)
}

/** Low means at or below the threshold; a threshold of 0 means only when it is gone. */
export const isLow = (stock: number | null, threshold: number) => stock !== null && stock <= threshold

/** The inventory item the app may change for this variant, with its levels; null for kits, untracked and unlinked variants. */
export function editableInventory(variant: VariantView): InventoryView | null {
  return variant.stock_editable ? (variant.inventory[0] ?? null) : null
}

/** What the variant is called in a list: its own title unless that is the placeholder every simple product carries. */
export function variantLabel(variant: Pick<VariantView, "title">, productTitle: string): string {
  const t = variant.title.trim()
  return !t || t.toLowerCase() === "default" || t === productTitle ? "" : t
}

/** A stock number typed into a count field: a whole number from 0 up to the limit, else null. */
export function parseCount(raw: string): number | null {
  const text = raw.replace(/[\s ]/g, "")
  if (!/^\d{1,7}$/.test(text)) return null
  const n = Number(text)
  return n <= MAX_STOCK ? n : null
}

/** The plain price of one currency, if the variant has one. */
export const basePrice = (variant: Pick<VariantView, "prices">, currency: string): PriceView | undefined =>
  variant.prices.find((p) => p.base && p.currency_code === currency.toLowerCase())

/** The currency the shop mostly sells in: the one of the first plain price. */
export const primaryCurrency = (product: Pick<ProductView, "variants">): string | null => product.variants.flatMap((v) => v.prices).find((p) => p.base)?.currency_code ?? null

/** The least a variant costs, for a list row: the cheapest plain price in its first currency. */
export function listPrice(product: Pick<ProductView, "variants">): { amount: number; currency: string; several: boolean } | null {
  const cur = primaryCurrency(product)
  if (!cur) return null
  const amounts = product.variants.flatMap((v) => v.prices).filter((p) => p.base && p.currency_code === cur).map((p) => p.amount)
  if (amounts.length === 0) return null
  const min = Math.min(...amounts)
  return { amount: min, currency: cur, several: Math.max(...amounts) !== min }
}
