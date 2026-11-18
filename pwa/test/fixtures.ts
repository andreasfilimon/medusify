import type { Dashboard, DashboardOrder, Order, Shop } from "../src/lib/types"

export const shop = (id: string, over: Partial<Shop> = {}): Shop => ({ id, url: `https://${id}`, name: id, color: 1, home: false, ...over })

export const order = (id: string, over: Partial<Order> = {}): Order =>
  ({
    id,
    display_id: Number(id.replace(/\D/g, "") || 1),
    status: "pending",
    created_at: "2026-11-16T10:00:00.000Z",
    currency_code: "eur",
    payment_status: "captured",
    fulfillment_status: "not_fulfilled",
    total: 10,
    ...over,
  }) as Order

export const dashboardOrder = (id: string, created_at: string): DashboardOrder => ({
  id,
  display_id: 1,
  created_at,
  currency_code: "eur",
  total: 1,
  status: "pending",
  payment_status: "captured",
  fulfillment_status: "not_fulfilled",
  country_code: "at",
  item_count: 1,
})

export const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
  timezone: "UTC",
  generated_at: "2026-11-16T10:00:00.000Z",
  today: { orders: 0, revenue: [] },
  month: { orders: 0, revenue: [] },
  to_ship: 0,
  recent_orders: [],
  ...over,
})
