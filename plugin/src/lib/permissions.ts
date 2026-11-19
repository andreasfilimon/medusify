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
  /** The plugin's own return route runs the whole return flow in one request. */
  return: [
    { resource: "return", operation: "create" },
    { resource: "return", operation: "update" },
    { resource: "order", operation: "update" },
  ],
} as const satisfies Record<string, readonly Policy[]>

export type AdminAction = keyof typeof ADMIN_ACTIONS
export const ADMIN_ACTION_KEYS = Object.keys(ADMIN_ACTIONS) as AdminAction[]
