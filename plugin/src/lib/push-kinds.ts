/**
 * Kinds of push messages. `order_placed` is the original one and always on. The others can be switched off per device
 * (and so per shop, because the plugin lives in the shop): the list of switched-off kinds is stored with the subscription.
 *
 * Only events that Medusa 2.22.x really emits are here: `order.canceled` and `order.return_requested`
 * (core-flows, utils/dist/core-flows/events.js). Medusa has no event for a failed payment, so there is no such kind.
 * `low_stock` comes from `reservation-item.created` (an order took stock) and `inventory-level.updated` (stock edited,
 * a return received); the threshold per device is `low_stock_threshold` on the subscription.
 * `daily_summary` is not switched here but chosen with its hour (`daily_summary_hour`, off by default), see lib/daily-summary.ts.
 */
export const PUSH_KINDS = ["order_placed", "canceled", "return_requested", "low_stock", "daily_summary"] as const
export type PushKind = (typeof PUSH_KINDS)[number]

export const SWITCHABLE_KINDS = ["canceled", "return_requested", "low_stock"] as const
export type SwitchableKind = (typeof SWITCHABLE_KINDS)[number]

export function isSwitchableKind(value: unknown): value is SwitchableKind {
  return typeof value === "string" && (SWITCHABLE_KINDS as readonly string[]).includes(value)
}

/** Only known, switchable kinds survive; the order is stable. */
export function cleanDisabledKinds(value: unknown): SwitchableKind[] {
  const list = Array.isArray(value) ? value : []
  return SWITCHABLE_KINDS.filter((kind) => list.includes(kind))
}

/** Whether a subscription with these switched-off kinds gets a message of this kind. */
export function wantsKind(disabled: unknown, kind: PushKind): boolean {
  return !cleanDisabledKinds(disabled).includes(kind as SwitchableKind)
}

/** Threshold for the low-stock push: whole units, 0 means "only when it is gone". Default of a new device. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5
export const MAX_LOW_STOCK_THRESHOLD = 9999

export function cleanThreshold(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_LOW_STOCK_THRESHOLD
  return Math.min(MAX_LOW_STOCK_THRESHOLD, Math.max(0, n))
}
