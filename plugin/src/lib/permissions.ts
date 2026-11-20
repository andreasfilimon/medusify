/**
 * Which Medusa policies every action of the app needs. The lists are the ones Medusa asks for itself on the core
 * routes (medusa/dist/api/admin/*\/middlewares.js, Medusa 2.22.7), so the app hides exactly the buttons whose request
 * Medusa would answer with 403. Wildcards (`*:*`, `order:*`, `*:update`) are resolved by Medusa's `hasPermission`.
 */
export type Policy = { resource: string; operation: string }

export const ADMIN_ACTIONS = {
  capture: [
    { resource: "capture", operation: "create" },
    { resource: "order", operation: "update" },
  ],
  mark_paid: [
    { resource: "payment_collection", operation: "update" },
    { resource: "order", operation: "update" },
  ],
  cancel: [{ resource: "order", operation: "update" }],
  /** Cancel an order that holds captured money: Medusa refunds it, so the refund right is needed as well. */
  cancel_refunding: [
    { resource: "order", operation: "update" },
    { resource: "refund", operation: "create" },
  ],
  deliver: [
    { resource: "fulfillment", operation: "update" },
    { resource: "order", operation: "update" },
  ],
  refund: [
    { resource: "refund", operation: "create" },
    { resource: "order", operation: "update" },
  ],
  /** Ship: the plugin's own ship route creates fulfillments and registers their shipments, Medusa's two routes in one. */
  ship: [
    { resource: "fulfillment", operation: "create" },
    { resource: "fulfillment", operation: "update" },
    { resource: "order", operation: "update" },
  ],
  /** Read the catalog: product list, detail, barcode lookup (Medusa asks product:read on /admin/products and product_variant:read on the variant routes). */
  catalog: [
    { resource: "product", operation: "read" },
    { resource: "product_variant", operation: "read" },
  ],
  /** Price and barcode of a variant: Medusa's variant update asks for both rights. */
  variant_edit: [
    { resource: "product_variant", operation: "update" },
    { resource: "product", operation: "update" },
  ],
  /** Draft or active: Medusa's product update. */
  product_status: [{ resource: "product", operation: "update" }],
  /** Count or change the stock of a variant (Medusa: inventory_level:update on the location-level route; the app reads the item first). */
  stock: [
    { resource: "inventory_item", operation: "read" },
    { resource: "inventory_level", operation: "update" },
  ],
  /** The stock location does not hold the item yet: the first count creates its level. */
  stock_new_level: [{ resource: "inventory_level", operation: "create" }],
  /** Quick create: Medusa asks for these on POST /admin/products with variants, inventory items and a sales channel. */
  product_create: [
    { resource: "product", operation: "create" },
    { resource: "product_variant", operation: "create" },
    { resource: "inventory_item", operation: "create" },
    { resource: "inventory_level", operation: "create" },
    { resource: "sales_channel", operation: "update" },
  ],
  /** The photo of a new product (Medusa: file:create on POST /admin/uploads). */
  upload: [{ resource: "file", operation: "create" }],
  /** Who gets the low-stock push: someone who may read products and their stock. */
  stock_read: [
    { resource: "product", operation: "read" },
    { resource: "inventory_item", operation: "read" },
  ],
  /** The plugin's own return route runs the whole return flow in one request. */
  return: [
    { resource: "return", operation: "create" },
    { resource: "return", operation: "update" },
    { resource: "order", operation: "update" },
  ],
} as const satisfies Record<string, readonly Policy[]>

export type AdminAction = keyof typeof ADMIN_ACTIONS
export const ADMIN_ACTION_KEYS = Object.keys(ADMIN_ACTIONS) as AdminAction[]
