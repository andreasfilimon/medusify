import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createInventoryItemsWorkflow, createProductsWorkflow, createStockLocationsWorkflow } from "@medusajs/medusa/core-flows"

export async function createLocation(container: MedusaContainer, name = "Lager Wien") {
  const { result } = await createStockLocationsWorkflow(container).run({ input: { locations: [{ name }] } })
  return result[0]!.id as string
}

type PriceIn = { currency_code: string; amount: number; min_quantity?: number; max_quantity?: number; rules?: Record<string, string> }

export type CatalogOpts = {
  title?: string
  status?: "draft" | "published"
  sku?: string
  barcode?: string
  ean?: string
  upc?: string
  manage_inventory?: boolean
  /** Locations and stocked quantities of the inventory item. Empty list: the item has no level at all. */
  levels?: { location_id: string; quantity: number }[]
  prices?: PriceIn[]
  /** How many units of the item one variant unit takes. */
  required_quantity?: number
  /** Do not link an inventory item to the variant. */
  noInventory?: boolean
  variantTitle?: string
}

/** A product with one variant, demo data only (`example.invalid`, invented names and codes). */
export async function createCatalogProduct(container: MedusaContainer, o: CatalogOpts = {}) {
  const fm = container.resolve(Modules.FULFILLMENT) as any
  const profile = await fm.createShippingProfiles({ name: `Profil ${Math.random().toString(36).slice(2, 8)}`, type: "default" })
  let itemId: string | null = null
  if (!o.noInventory) {
    const { result: items } = await createInventoryItemsWorkflow(container).run({
      input: { items: [{ title: o.title ?? "Demo Tasse", sku: o.sku, location_levels: (o.levels ?? []).map((l) => ({ location_id: l.location_id, stocked_quantity: l.quantity })) }] },
    })
    itemId = items[0]!.id as string
  }
  const { result: products } = await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: o.title ?? "Demo Tasse",
          status: o.status ?? "published",
          shipping_profile_id: profile.id,
          options: [{ title: "Größe", values: ["M"] }],
          variants: [
            {
              title: o.variantTitle ?? "M",
              sku: o.sku,
              barcode: o.barcode,
              ean: o.ean,
              upc: o.upc,
              manage_inventory: o.manage_inventory ?? true,
              options: { Größe: "M" },
              prices: o.prices ?? [{ currency_code: "eur", amount: 12.5 }],
              ...(itemId ? { inventory_items: [{ inventory_item_id: itemId, required_quantity: o.required_quantity ?? 1 }] } : {}),
            },
          ],
        },
      ],
    } as any,
  })
  const product = products[0] as any
  return { productId: product.id as string, variantId: product.variants[0].id as string, inventoryItemId: itemId }
}
