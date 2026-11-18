import { describe, expect, it } from "vitest"
import { aggregateRevenue, recentOrders } from "../src/lib/dashboard"
import { dashboard, dashboardOrder, shop } from "./fixtures"

describe("aggregateRevenue", () => {
  it("sums the same currency across shops and never mixes currencies", () => {
    const rows = aggregateRevenue(
      [
        { shop: shop("a"), data: dashboard({ today: { orders: 2, revenue: [{ currency_code: "eur", amount: 10.1 }] } }) },
        { shop: shop("b"), data: dashboard({ today: { orders: 1, revenue: [{ currency_code: "EUR", amount: 5.2 }] } }) },
        { shop: shop("c"), data: dashboard({ today: { orders: 4, revenue: [{ currency_code: "usd", amount: 99 }] } }) },
      ],
      "today",
    )
    expect(rows).toEqual([
      { currency: "USD", amount: 99, orders: 4, shops: 1 },
      { currency: "EUR", amount: 15.3, orders: 3, shops: 2 },
    ])
  })
  it("leaves the order count empty when a shop sells in several currencies", () => {
    const rows = aggregateRevenue(
      [{ shop: shop("a"), data: dashboard({ month: { orders: 5, revenue: [{ currency_code: "eur", amount: 1 }, { currency_code: "usd", amount: 2 }] } }) }],
      "month",
    )
    expect(rows.every((r) => r.orders === null)).toBe(true)
  })
  it("returns nothing for no revenue", () => expect(aggregateRevenue([{ shop: shop("a"), data: dashboard() }], "today")).toEqual([]))
})

describe("recentOrders", () => {
  it("merges shops newest first and limits", () => {
    const list = [
      { shop: shop("a"), data: dashboard({ recent_orders: [dashboardOrder("o1", "2026-11-16T08:00:00Z"), dashboardOrder("o3", "2026-11-16T10:00:00Z")] }) },
      { shop: shop("b"), data: dashboard({ recent_orders: [dashboardOrder("o2", "2026-11-16T09:00:00Z")] }) },
    ]
    expect(recentOrders(list, 2).map((x) => x.order.id)).toEqual(["o3", "o2"])
  })
})
