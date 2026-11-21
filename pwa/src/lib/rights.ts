import type { ActionKey, Permissions } from "./actions"

/**
 * The rights screen in plain words: each line is one thing a person can do in the app, and the rights it needs. A line
 * counts as allowed only when all its actions are (e.g. "change orders" = edit, exchange and claim). Every action of
 * ACTION_KEYS is on exactly one line (test: pwa/test/rights.test.ts).
 */
export const RIGHT_GROUPS: { id: string; lines: { id: string; actions: ActionKey[] }[] }[] = [
  {
    id: "orders",
    lines: [
      { id: "ship", actions: ["ship", "deliver"] },
      { id: "paid", actions: ["capture", "mark_paid"] },
      { id: "refund", actions: ["refund"] },
      { id: "cancel", actions: ["cancel", "cancel_refunding"] },
      { id: "return", actions: ["return"] },
      { id: "change", actions: ["order_edit", "exchange", "claim"] },
      { id: "manual", actions: ["manual_order"] },
    ],
  },
  {
    id: "catalog",
    lines: [
      { id: "browse", actions: ["catalog", "stock_read"] },
      { id: "stock", actions: ["stock", "stock_new_level"] },
      { id: "price", actions: ["variant_edit", "product_status"] },
      { id: "create", actions: ["product_create", "upload"] },
    ],
  },
  {
    id: "shop",
    lines: [
      { id: "customers", actions: ["customers"] },
      { id: "discounts", actions: ["discounts"] },
      { id: "discountEdit", actions: ["discount_create", "discount_edit"] },
      { id: "reports", actions: ["reports"] },
    ],
  },
]

export type LineState = "yes" | "part" | "no"

/** All of the line's actions allowed: yes; some: part (the screen says which part is missing); none: no. */
export function lineState(p: Permissions, actions: readonly ActionKey[]): LineState {
  const n = actions.filter((a) => p[a]).length
  return n === actions.length ? "yes" : n === 0 ? "no" : "part"
}
