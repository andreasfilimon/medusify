import type { Order, DashboardOrder } from "./types"

export type OrderFilter = "open" | "shipped" | "canceled" | "all"
export type OrderState = "to_ship" | "partly" | "payment_pending" | "refunded" | "shipped" | "canceled" | "open"

type Stated = Pick<Order, "status" | "payment_status" | "fulfillment_status"> | DashboardOrder

const SHIPPED = new Set(["shipped", "delivered", "partially_delivered"])
const PARTLY = new Set(["partially_shipped", "partially_fulfilled"])
/** The order statuses the plugin counts for "to ship" (OPEN_STATUSES in plugin/src/lib/dashboard.ts). */
const OPEN_ORDER = new Set(["pending", "requires_action"])

/**
 * One state per order, derived from Medusa's computed statuses.
 * to_ship = paid and nothing shipped yet, partly = paid and some lines shipped, payment_pending = not paid yet,
 * refunded = the whole payment was refunded and nothing is on its way (nothing left to do).
 *
 * Same rule as the plugin's `needsShipping` (plugin/src/lib/dashboard.ts), and both are tested against one table
 * (shared-test-data/ship-rule.json): the queue and the detail offer shipping (to_ship, partly) only for a paid order.
 * Paid = Medusa's aggregated payment status is captured or partially_refunded. Medusa reports "partially_refunded"
 * as soon as any refund exists (core-flows aggregate-status.js, the refund branch comes before the captured branch)
 * and the admin list shows it as a warning (orange) next to the open fulfillment, so such an order is still shipped.
 * Only a full refund ("refunded", red in the admin list) ends the shipping, also when part of the order has gone out
 * already: what is left is not paid any more. The payment is checked before the partial shipping, so an unpaid order
 * is never offered for shipping either. Fully shipped or delivered orders are "shipped", whatever the payment says.
 * Medusa lets a merchant complete or archive an order without any check of its shipping, so such an order can hold
 * unshipped goods; the plugin counts only pending and requires_action orders, and so does the app: a closed order with
 * paid, unshipped goods is "open" (listed, not offered for shipping).
 */
export function orderState(o: Stated): OrderState {
  if (o.status === "canceled") return "canceled"
  if (SHIPPED.has(o.fulfillment_status)) return "shipped"
  if (o.payment_status === "refunded") return "refunded"
  if (o.payment_status === "captured" || o.payment_status === "partially_refunded") {
    if (!OPEN_ORDER.has(o.status)) return "open"
    return PARTLY.has(o.fulfillment_status) ? "partly" : "to_ship"
  }
  return "payment_pending"
}

export function matchesFilter(o: Stated, filter: OrderFilter): boolean {
  const state = orderState(o)
  switch (filter) {
    case "all":
      return true
    case "canceled":
      return state === "canceled"
    case "shipped":
      return state === "shipped"
    case "open":
      return state !== "canceled" && state !== "shipped" && state !== "refunded"
  }
}

/**
 * The goods line of the totals. Medusa's `subtotal` already contains the shipping, so showing it next to the shipping
 * counted the shipping twice. `item_total` is the goods with tax, which adds up with `shipping_total` to `total`.
 */
export function goodsTotal(o: Pick<Order, "item_total" | "items">): number | undefined {
  if (typeof o.item_total === "number") return o.item_total
  if (!o.items?.length) return undefined
  return o.items.reduce((sum, i) => sum + (typeof i.total === "number" ? i.total : 0), 0)
}

export function customerName(o: Pick<Order, "shipping_address" | "email">): string {
  const a = o.shipping_address
  const name = [a?.first_name, a?.last_name].filter(Boolean).join(" ").trim()
  return name || o.email || "-"
}
