import { byNewest } from "./feed"
import type { Dashboard, DashboardOrder, Shop, ShopOrder } from "./types"

export type Period = "today" | "month"

export type RevenueRow = {
  currency: string
  amount: number
  /** Orders in that currency. Null when a shop sells in several currencies: the dashboard does not split the count. */
  orders: number | null
  shops: number
}

/** Currencies are never added together. Same currency across shops is summed, everything else stays a row of its own. */
export function aggregateRevenue(list: { shop: Pick<Shop, "id">; data: Dashboard }[], period: Period): RevenueRow[] {
  const rows = new Map<string, { amount: number; orders: number | null; shops: Set<string> }>()
  for (const { shop, data } of list) {
    const part = data[period]
    for (const r of part.revenue) {
      const key = r.currency_code.toUpperCase()
      const row = rows.get(key) ?? { amount: 0, orders: 0, shops: new Set<string>() }
      row.amount += r.amount
      row.shops.add(shop.id)
      row.orders = part.revenue.length === 1 && row.orders !== null ? row.orders + part.orders : null
      rows.set(key, row)
    }
  }
  return [...rows.entries()]
    .map(([currency, r]) => ({ currency, amount: Math.round(r.amount * 100) / 100, orders: r.orders, shops: r.shops.size }))
    .sort((a, b) => b.amount - a.amount)
}

export function recentOrders(list: { shop: Shop; data: Dashboard }[], limit = 5): ShopOrder<DashboardOrder>[] {
  const all = list.flatMap(({ shop, data }) => data.recent_orders.map((order) => ({ shop, order })))
  return all.sort(byNewest as unknown as (a: ShopOrder<DashboardOrder>, b: ShopOrder<DashboardOrder>) => number).slice(0, limit)
}
