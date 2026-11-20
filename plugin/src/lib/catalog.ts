import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { type Amount, toNumber } from "./bignum"

/**
 * What the app shows of the catalog. One loader (`toProductViews`) serves the list, the detail and the barcode lookup, so
 * a number means the same everywhere. Everything is read with `query.graph`; the stock comes from the inventory levels
 * themselves (stocked minus reserved), never from a cached availability, so a count the app just made reads back at once.
 */

export type PriceView = {
  id: string
  currency_code: string
  amount: number
  /** A plain price of the variant: no rules (region, customer group) and no quantity tiers. Only these can be changed in the app. */
  base: boolean
}

export type LevelView = {
  location_id: string
  location_name: string
  stocked: number
  reserved: number
  /** Stocked minus reserved: what can still be sold from this location. */
  available: number
  incoming: number
}

export type InventoryView = {
  inventory_item_id: string
  /** How many units of this item one unit of the variant takes (more than 1, or several items, is an inventory kit). */
  required_quantity: number
  levels: LevelView[]
}

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
  /** Units that can be sold over all locations, kits divided by `required_quantity`; null when the variant does not track stock. */
  stock_total: number | null
  /** The app may count and change this stock: one inventory item, one unit per variant unit. */
  stock_editable: boolean
  /** The user may not read stock (no `inventory_item:read`): `inventory` is empty and `stock_total` null for that reason, not because the variant is untracked. */
  stock_hidden: boolean
}

export type ProductView = {
  id: string
  title: string
  status: string
  thumbnail: string | null
  variants: VariantView[]
}

export type MatchField = "barcode" | "sku" | "ean" | "upc"
/** Order of trust when a code fits several fields (the brief: barcode, then sku, then ean and upc). */
export const MATCH_ORDER: readonly MatchField[] = ["barcode", "sku", "ean", "upc"]

type RawLevel = { location_id: string; stocked_quantity?: Amount; reserved_quantity?: Amount; incoming_quantity?: Amount }
type RawLink = {
  variant_id: string
  inventory_item_id: string
  required_quantity?: Amount
  inventory?: { location_levels?: (RawLevel | null)[] | null } | null
}
type RawPrice = {
  id: string
  amount?: Amount
  currency_code?: string | null
  min_quantity?: Amount
  max_quantity?: Amount
  rules_count?: number | null
  price_list_id?: string | null
}
type RawVariant = {
  id: string
  title?: string | null
  sku?: string | null
  barcode?: string | null
  ean?: string | null
  upc?: string | null
  manage_inventory?: boolean | null
  allow_backorder?: boolean | null
  price_set?: { prices?: (RawPrice | null)[] | null } | null
}
type RawProduct = {
  id: string
  title?: string | null
  status?: string | null
  thumbnail?: string | null
  variants?: (RawVariant | null)[] | null
}

const present = <T>(v: T | null | undefined): v is T => v !== null && v !== undefined

/** A plain price has no rules and no quantity tier. */
export function isBasePrice(p: Pick<RawPrice, "rules_count" | "min_quantity" | "max_quantity">): boolean {
  return !(p.rules_count ?? 0) && !present(p.min_quantity) && !present(p.max_quantity)
}

/**
 * The variant's own prices. A price of a price list (a sale, a customer-group list) also hangs on the price set, but it
 * belongs to its list: Medusa's price update neither keeps nor deletes it (`updatePriceSets_` reads `price_list_id: null`),
 * so it is neither shown as the variant's price nor sent back. Medusa 2.22.7 does not list them under `price_set.prices`
 * (measured in the catalog spec); the filter keeps it that way if a later version does.
 */
export function toPriceViews(prices: (RawPrice | null)[] | null | undefined): PriceView[] {
  return (prices ?? [])
    .filter(present)
    .filter((p) => !p.price_list_id)
    .filter((p) => !!p.currency_code)
    .map((p) => ({ id: p.id, currency_code: p.currency_code!.toLowerCase(), amount: toNumber(p.amount), base: isBasePrice(p) }))
    .sort((a, b) => a.currency_code.localeCompare(b.currency_code) || Number(b.base) - Number(a.base))
}

/**
 * Units that can be sold: per inventory item the available units of all levels divided by what one variant unit takes,
 * rounded down, and the smallest of these (Medusa's own rule for a kit). Null when stock is not tracked or nothing is linked.
 */
export function stockTotal(managed: boolean, inventory: InventoryView[]): number | null {
  if (!managed || inventory.length === 0) return null
  const perItem = inventory.map((i) => Math.floor(i.levels.reduce((sum, l) => sum + l.available, 0) / Math.max(1, i.required_quantity)))
  return Math.max(0, Math.min(...perItem))
}

/** One inventory item, one unit per variant unit: the app can count it. A kit is counted in the Medusa admin. */
export function isStockEditable(managed: boolean, inventory: InventoryView[]): boolean {
  return managed && inventory.length === 1 && inventory[0]!.required_quantity === 1
}

/**
 * The codes to look for: the scanned text, and the other spelling of the same product number. A UPC-A (12 digits) is an
 * EAN-13 with a leading 0, and phones and scanners report either.
 */
export function codeCandidates(raw: string): string[] {
  const code = raw.trim()
  if (!code) return []
  const out = new Set([code])
  if (/^\d{12}$/.test(code)) out.add(`0${code}`)
  if (/^0\d{12}$/.test(code)) out.add(code.slice(1))
  return [...out]
}

/** Which field of a variant the code fits, by the order of trust; null when none. */
export function matchedBy(variant: Pick<VariantView, MatchField>, candidates: readonly string[]): MatchField | null {
  for (const field of MATCH_ORDER) {
    const value = variant[field]
    if (value && candidates.includes(value)) return field
  }
  return null
}

const rank = (f: MatchField) => MATCH_ORDER.indexOf(f)

/** Hits sorted by the order of trust, ties by product and variant title so the answer does not depend on the database order. */
export function sortMatches<T extends { matched_by: MatchField; product: { title: string }; variant: { title: string } }>(hits: T[]): T[] {
  return [...hits].sort(
    (a, b) => rank(a.matched_by) - rank(b.matched_by) || a.product.title.localeCompare(b.product.title) || a.variant.title.localeCompare(b.variant.title)
  )
}

export function toVariantView(v: RawVariant, links: RawLink[], locationNames: Map<string, string>, stockHidden = false): VariantView {
  const managed = v.manage_inventory !== false
  const inventory: InventoryView[] = links
    .filter((l) => l.variant_id === v.id)
    .map((l) => ({
      inventory_item_id: l.inventory_item_id,
      required_quantity: toNumber(l.required_quantity ?? 1) || 1,
      levels: (l.inventory?.location_levels ?? []).filter(present).map((lv) => {
        const stocked = toNumber(lv.stocked_quantity)
        const reserved = toNumber(lv.reserved_quantity)
        return {
          location_id: lv.location_id,
          location_name: locationNames.get(lv.location_id) ?? lv.location_id,
          stocked,
          reserved,
          available: stocked - reserved,
          incoming: toNumber(lv.incoming_quantity),
        }
      }),
    }))
  return {
    id: v.id,
    title: v.title ?? "",
    sku: v.sku ?? null,
    barcode: v.barcode ?? null,
    ean: v.ean ?? null,
    upc: v.upc ?? null,
    manage_inventory: managed,
    allow_backorder: v.allow_backorder === true,
    prices: toPriceViews(v.price_set?.prices),
    inventory,
    stock_total: stockTotal(managed, inventory),
    stock_editable: isStockEditable(managed, inventory),
    stock_hidden: stockHidden,
  }
}

export const PRODUCT_FIELDS = [
  "id",
  "title",
  "status",
  "thumbnail",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.barcode",
  "variants.ean",
  "variants.upc",
  "variants.manage_inventory",
  "variants.allow_backorder",
  "variants.price_set.prices.id",
  "variants.price_set.prices.amount",
  "variants.price_set.prices.currency_code",
  "variants.price_set.prices.min_quantity",
  "variants.price_set.prices.max_quantity",
  "variants.price_set.prices.rules_count",
  "variants.price_set.prices.price_list_id",
]

type Query = { graph(input: Record<string, unknown>): Promise<{ data: any[]; metadata?: { count?: number; skip?: number; take?: number } }> }

const queryOf = (container: MedusaContainer) => container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query

/** The stock locations' names by id, for the levels of these inventory links. */
async function locationNamesOf(query: Query, links: RawLink[]): Promise<Map<string, string>> {
  const ids = [...new Set(links.flatMap((l) => (l.inventory?.location_levels ?? []).filter(present).map((lv) => lv.location_id)))]
  if (ids.length === 0) return new Map()
  const { data } = await query.graph({ entity: "stock_location", fields: ["id", "name"], filters: { id: ids } })
  return new Map((data as { id: string; name?: string | null }[]).map((l) => [l.id, l.name ?? l.id]))
}

async function linksOf(query: Query, variantIds: string[]): Promise<RawLink[]> {
  if (variantIds.length === 0) return []
  const { data } = await query.graph({
    entity: "product_variant_inventory_items",
    fields: [
      "variant_id",
      "inventory_item_id",
      "required_quantity",
      "inventory.location_levels.location_id",
      "inventory.location_levels.stocked_quantity",
      "inventory.location_levels.reserved_quantity",
      "inventory.location_levels.incoming_quantity",
    ],
    filters: { variant_id: variantIds },
  })
  return data as RawLink[]
}

/**
 * Whether the stock is part of the answer. Medusa guards stock with `inventory_item:read`, the catalog only with the product
 * rights, so a role that may read products but not stock gets the catalog without any stock number.
 */
export type StockAccess = { stock: boolean }

export async function toProductViews(container: MedusaContainer, raw: RawProduct[], access: StockAccess): Promise<ProductView[]> {
  const query = queryOf(container)
  const variantIds = raw.flatMap((p) => (p.variants ?? []).filter(present).map((v) => v.id))
  const links = access.stock ? await linksOf(query, variantIds) : []
  const names = await locationNamesOf(query, links)
  return raw.map((p) => ({
    id: p.id,
    title: p.title ?? "",
    status: p.status ?? "draft",
    thumbnail: p.thumbnail ?? null,
    variants: (p.variants ?? []).filter(present).map((v) => toVariantView(v, links, names, !access.stock)),
  }))
}

export type ProductPage = { products: ProductView[]; count: number }

export async function listProducts(
  container: MedusaContainer,
  input: { q?: string; status?: string; offset: number; limit: number },
  access: StockAccess
): Promise<ProductPage> {
  const filters: Record<string, unknown> = {}
  if (input.q) filters.q = input.q
  if (input.status) filters.status = input.status
  const { data, metadata } = await queryOf(container).graph({
    entity: "product",
    fields: PRODUCT_FIELDS,
    filters,
    pagination: { skip: input.offset, take: input.limit, order: { title: "ASC" } },
  })
  return { products: await toProductViews(container, data as RawProduct[], access), count: metadata?.count ?? data.length }
}

export async function getProduct(container: MedusaContainer, id: string, access: StockAccess): Promise<ProductView | null> {
  const { data } = await queryOf(container).graph({ entity: "product", fields: PRODUCT_FIELDS, filters: { id } })
  if (data.length === 0) return null
  return (await toProductViews(container, data as RawProduct[], access))[0] ?? null
}

export type LookupMatch = { product: Omit<ProductView, "variants">; variant: VariantView; matched_by: MatchField }

/** The variants whose barcode, SKU, EAN or UPC is this code (or its UPC/EAN twin), the best fit first. */
export async function lookupVariants(container: MedusaContainer, code: string, access: StockAccess): Promise<LookupMatch[]> {
  const candidates = codeCandidates(code)
  if (candidates.length === 0) return []
  const query = queryOf(container)
  const { data } = await query.graph({
    entity: "variant",
    fields: ["id", "product_id"],
    filters: { $or: MATCH_ORDER.map((field) => ({ [field]: candidates })) },
    pagination: { take: 25 },
  })
  const productIds = [...new Set((data as { product_id?: string | null }[]).map((v) => v.product_id).filter(present))]
  if (productIds.length === 0) return []
  const { data: products } = await query.graph({ entity: "product", fields: PRODUCT_FIELDS, filters: { id: productIds } })
  const views = await toProductViews(container, products as RawProduct[], access)
  const hits: LookupMatch[] = []
  for (const product of views) {
    for (const variant of product.variants) {
      const field = matchedBy(variant, candidates)
      if (field) hits.push({ product: { id: product.id, title: product.title, status: product.status, thumbnail: product.thumbnail }, variant, matched_by: field })
    }
  }
  return sortMatches(hits)
}
