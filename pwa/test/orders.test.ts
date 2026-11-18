import { describe, expect, it } from "vitest"
import { goodsTotal, matchesFilter, orderState } from "../src/lib/orders"
import { order } from "./fixtures"

describe("order state", () => {
  it("paid and nothing shipped is to_ship", () => expect(orderState(order("1"))).toBe("to_ship"))
  it("unpaid is payment_pending", () => expect(orderState(order("1", { payment_status: "awaiting" }))).toBe("payment_pending"))
  it("partially shipped is partly", () => expect(orderState(order("1", { fulfillment_status: "partially_shipped" }))).toBe("partly"))
  it("shipped and delivered count as shipped", () => {
    expect(orderState(order("1", { fulfillment_status: "shipped" }))).toBe("shipped")
    expect(orderState(order("1", { fulfillment_status: "delivered" }))).toBe("shipped")
  })
  it("canceled wins over everything", () => expect(orderState(order("1", { status: "canceled", fulfillment_status: "shipped" }))).toBe("canceled"))
  it("a fully refunded order is not to ship, and not open", () => {
    const refunded = order("1", { payment_status: "refunded" })
    expect(orderState(refunded)).toBe("refunded")
    expect(matchesFilter(refunded, "open")).toBe(false)
    expect(matchesFilter(refunded, "all")).toBe(true)
  })
  it("a partly refunded order still ships (Medusa lists it as partially refunded, not as refunded)", () => {
    expect(orderState(order("1", { payment_status: "partially_refunded" }))).toBe("to_ship")
    expect(orderState(order("1", { payment_status: "partially_refunded", fulfillment_status: "partially_fulfilled" }))).toBe("partly")
  })
  it("a fully refunded order with a part on its way is not offered for shipping either", () => {
    for (const fulfillment_status of ["partially_fulfilled", "partially_shipped"]) {
      const o = order("1", { payment_status: "refunded", fulfillment_status })
      expect(orderState(o)).toBe("refunded")
      expect(matchesFilter(o, "open")).toBe(false)
    }
  })
  it("a part shipped order that is not paid is not offered for shipping", () => {
    expect(orderState(order("1", { payment_status: "awaiting", fulfillment_status: "partially_shipped" }))).toBe("payment_pending")
  })
  it("a refunded order that already shipped stays shipped", () => {
    expect(orderState(order("1", { payment_status: "refunded", fulfillment_status: "shipped" }))).toBe("shipped")
  })
  it("filters open, shipped, canceled", () => {
    const open = order("1")
    const shipped = order("2", { fulfillment_status: "shipped" })
    const canceled = order("3", { status: "canceled" })
    expect([open, shipped, canceled].map((o) => matchesFilter(o, "open"))).toEqual([true, false, false])
    expect([open, shipped, canceled].map((o) => matchesFilter(o, "shipped"))).toEqual([false, true, false])
    expect([open, shipped, canceled].map((o) => matchesFilter(o, "canceled"))).toEqual([false, false, true])
  })
})

describe("goods total", () => {
  it("uses item_total, never the subtotal that already holds the shipping", () => {
    const o = order("1", { subtotal: 14.8, shipping_total: 4.9, item_total: 9.9, total: 14.8 })
    expect(goodsTotal(o)).toBe(9.9)
    expect((goodsTotal(o) ?? 0) + (o.shipping_total ?? 0)).toBeCloseTo(o.total)
  })
  it("falls back to the sum of the lines", () => {
    const o = order("1", { item_total: undefined, items: [{ total: 9.9 }, { total: 5 }] as never })
    expect(goodsTotal(o)).toBeCloseTo(14.9)
  })
})
