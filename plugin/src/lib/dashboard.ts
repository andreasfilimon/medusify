import type { MedusaContainer } from "@medusajs/framework/types"
import { MathBN } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import { toBN, toNumber } from "./bignum"
import { dayAndMonthStart } from "./time"

const PAGE_SIZE = 500
/** Orders in other states (canceled, draft) never count as revenue. */
const REVENUE_STATUSES = ["pending", "completed", "archived", "requires_action"]
/** Orders in these states can still wait for shipping. */
export const OPEN_STATUSES = ["pending", "requires_action"]
/**
 * Fulfillment states with goods that are not on their way yet. "canceled" belongs here: canceling a fulfillment gives
 * its quantity back (order module, CANCEL_ITEM_FULFILLMENT lowers fulfilled_quantity), so a paid order whose only
 * fulfillment was canceled has to be shipped again. A canceled
 * order itself (order status canceled) never gets here, see OPEN_STATUSES.
 */
const NOT_SHIPPED = ["not_fulfilled", "partially_fulfilled", "fulfilled", "partially_shipped", "canceled"]
/**
 * Payment states (Medusa's aggregated `payment_status`, as the admin order list shows it) that count as paid
 * for REVENUE: the card is authorized or the money is captured. "partially_refunded" is what Medusa reports as soon
 * as any refund exists (core-flows aggregate-status.js: the refund branch comes before the captured branch), so a
 * captured order with a small refund still has to count. A fully "refunded" order is no sale any more.
 * "partially_captured" and "partially_authorized" mean that part of the order is unpaid, they do not count.
 */
const REVENUE_PAYMENT = ["authorized", "captured", "partially_refunded"]
/**
 * Payment states that make an order SHIPPABLE: the money has been captured. An authorized-only order is
 * revenue (above) but is not shipped before the capture, same as in the Medusa admin. A fully refunded order
 * is not shipped any more, even when part of it has gone out already. The PWA applies the same rule
 * (pwa/src/lib/orders.ts, `orderState`); both are tested against shared-test-data/ship-rule.json.
 */
const SHIPPABLE_PAYMENT = ["captured", "partially_refunded"]

/** Paid (captured, possibly partly refunded) and not on its way yet. Exported for tests. */
export function needsShipping(paymentStatus: string, fulfillmentStatus: string): boolean {
  return SHIPPABLE_PAYMENT.includes(paymentStatus) && NOT_SHIPPED.includes(fulfillmentStatus)
}

/** Counts towards today's / this month's revenue. Exported for tests. */
export function countsAsRevenue(paymentStatus: string): boolean {
  return REVENUE_PAYMENT.includes(paymentStatus)
}

export type RevenueByCurrency = { currency_code: string; amount: number }[]

export type MedusifyDashboard = {
  timezone: string
  generated_at: string
  today: { orders: number; revenue: RevenueByCurrency }
  month: { orders: number; revenue: RevenueByCurrency }
  to_ship: number
  recent_orders: {
    id: string
    display_id: number
    created_at: string
    currency_code: string
    total: number
    status: string
    payment_status: string
    fulfillment_status: string
    country_code: string | null
    item_count: number
  }[]
}

type ListShape<T> = T[] | { rows: T[] }
const rowsOf = <T>(res: ListShape<T>): T[] => (Array.isArray(res) ? res : res.rows ?? [])

/** Page through Medusa's own order list (same statuses and totals as the admin order list). */
async function* pagedOrderList(container: MedusaContainer, fields: string[], filters: Record<string, unknown>) {
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { result } = await getOrdersListWorkflow(container).run({
      input: {
        fields,
        variables: { filters, skip, take: PAGE_SIZE, order: { created_at: "ASC", id: "ASC" } },
      },
    })
    const page = rowsOf(result as ListShape<Record<string, any>>)
    for (const order of page) yield order
    if (page.length < PAGE_SIZE) return
  }
}

type Revenue = { orders: number; revenue: RevenueByCurrency }

/**
 * Revenue = sum of `summary.current_order_total` of the orders in the period that are not canceled or draft AND
 * whose payment is authorized or captured (see REVENUE_PAYMENT). `current_order_total` already has refunds and
 * returns taken off (measured against Medusa 2.22.7: 44.98 paid, 5 refunded gives 39.98, fully refunded gives 0), so
 * nothing is subtracted a second time. Per currency, never mixed. `orders` counts the same orders.
 *
 * The payment status is not a column but aggregated in memory by getOrdersListWorkflow, so the month is read in
 * one pass and "today" is derived from it.
 */
async function revenueSince(container: MedusaContainer, monthStart: Date, todayStart: Date): Promise<{ month: Revenue; today: Revenue }> {
  const sums = { month: new Map<string, ReturnType<typeof toBN>>(), today: new Map<string, ReturnType<typeof toBN>>() }
  const counts = { month: 0, today: 0 }
  for await (const order of pagedOrderList(container, ["id", "created_at", "currency_code", "summary.current_order_total"], {
    created_at: { $gte: monthStart.toISOString() },
    status: REVENUE_STATUSES,
  })) {
    if (!countsAsRevenue(order.payment_status)) continue
    const code = String(order.currency_code).toLowerCase()
    const amount = toBN(order.summary?.current_order_total)
    const periods = new Date(order.created_at).getTime() >= todayStart.getTime() ? (["month", "today"] as const) : (["month"] as const)
    for (const period of periods) {
      counts[period]++
      sums[period].set(code, MathBN.add(sums[period].get(code) ?? 0, amount))
    }
  }
  const finish = (period: "month" | "today"): Revenue => ({
    orders: counts[period],
    revenue: [...sums[period].entries()]
      .map(([currency_code, amount]) => ({ currency_code, amount: amount.toNumber() }))
      .sort((a, b) => a.currency_code.localeCompare(b.currency_code)),
  })
  return { month: finish("month"), today: finish("today") }
}

/**
 * "To ship" = paid (SHIPPABLE_PAYMENT), not shipped, not canceled. The payment/fulfillment status is NOT a column but
 * aggregated in memory by Medusa's own getOrdersListWorkflow (same logic as the admin order list),
 * so it can't be filtered in SQL: scan all open orders page by page.
 */
export async function countToShip(container: MedusaContainer): Promise<number> {
  let count = 0
  for await (const order of pagedOrderList(container, ["id"], { status: OPEN_STATUSES })) {
    if (needsShipping(order.payment_status, order.fulfillment_status)) count++
  }
  return count
}

async function recentOrders(container: MedusaContainer): Promise<MedusifyDashboard["recent_orders"]> {
  const { result } = await getOrdersListWorkflow(container).run({
    input: {
      fields: [
        "id",
        "display_id",
        "created_at",
        "currency_code",
        "status",
        "summary.current_order_total",
        "shipping_address.country_code",
        "items.quantity",
        "payment_collections.status",
        "fulfillments.packed_at",
      ],
      variables: {
        filters: { status: [...REVENUE_STATUSES, "canceled"] },
        skip: 0,
        take: 10,
        order: { created_at: "DESC", id: "DESC" },
      },
    },
  })
  return rowsOf(result as ListShape<Record<string, any>>).map((o) => ({
    id: o.id,
    display_id: o.display_id,
    created_at: new Date(o.created_at).toISOString(),
    currency_code: String(o.currency_code).toLowerCase(),
    total: toNumber(o.summary?.current_order_total),
    status: o.status,
    payment_status: o.payment_status,
    fulfillment_status: o.fulfillment_status,
    country_code: o.shipping_address?.country_code ?? null,
    item_count: (o.items ?? []).reduce((sum: number, i: any) => sum + toNumber(i?.quantity), 0),
  }))
}

export async function buildDashboard(
  container: MedusaContainer,
  timezone: string,
  now: Date = new Date()
): Promise<MedusifyDashboard> {
  const { todayStart, monthStart } = dayAndMonthStart(now, timezone)
  const [{ month, today }, toShip, recent] = await Promise.all([
    revenueSince(container, monthStart, todayStart),
    countToShip(container),
    recentOrders(container),
  ])
  return {
    timezone,
    generated_at: now.toISOString(),
    today,
    month,
    to_ship: toShip,
    recent_orders: recent,
  }
}
