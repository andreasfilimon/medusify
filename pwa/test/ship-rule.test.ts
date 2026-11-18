import { describe, expect, it } from "vitest"
import table from "../../shared-test-data/ship-rule.json"
import { matchesFilter, orderState } from "../src/lib/orders"
import { order } from "./fixtures"

// The same table the plugin's needsShipping is tested against (plugin/src/__tests__/ship-rule.unit.spec.ts).
const rule: { order_statuses: string[]; payment_statuses: string[]; fulfillment_statuses: string[]; shippable: { order_status: string[]; payment: string[]; fulfillment: string[] } } = table

const cases = rule.order_statuses.flatMap((o) =>
  rule.payment_statuses.flatMap((p) =>
    rule.fulfillment_statuses.map((f) => [o, p, f, rule.shippable.order_status.includes(o) && rule.shippable.payment.includes(p) && rule.shippable.fulfillment.includes(f)] as const),
  ),
)

/** The ship queue and the order detail offer shipping for exactly these two states. */
const offersShipping = (status: string, payment: string, fulfillment: string) =>
  ["to_ship", "partly"].includes(orderState(order("1", { status, payment_status: payment, fulfillment_status: fulfillment })))

describe("ship rule (shared with the plugin)", () => {
  it.each(cases)("shipping is offered for order %s + payment %s + fulfillment %s: %s", (status, payment, fulfillment, expected) => {
    expect(offersShipping(status, payment, fulfillment)).toBe(expected)
  })

  it("a completed order with goods that are not on their way is open, not to ship", () => {
    expect(orderState(order("1", { status: "completed", payment_status: "captured", fulfillment_status: "not_fulfilled" }))).toBe("open")
    expect(matchesFilter(order("1", { status: "completed", payment_status: "captured", fulfillment_status: "not_fulfilled" }), "open")).toBe(true)
  })

  it("a fully refunded order is never offered for shipping, whatever is already on its way", () => {
    for (const f of rule.fulfillment_statuses.filter((f) => !["shipped", "partially_delivered", "delivered"].includes(f))) {
      const o = order("1", { payment_status: "refunded", fulfillment_status: f })
      expect(orderState(o)).toBe("refunded")
      expect(matchesFilter(o, "open")).toBe(false)
    }
  })

  it("a refunded order that is already shipped or delivered stays shipped", () => {
    for (const f of ["shipped", "partially_delivered", "delivered"]) expect(orderState(order("1", { payment_status: "refunded", fulfillment_status: f }))).toBe("shipped")
  })
})
