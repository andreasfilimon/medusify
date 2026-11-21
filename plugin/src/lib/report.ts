import type { MedusaContainer } from "@medusajs/framework/types"
import { MathBN, MedusaError } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import { toBN, toNumber } from "./bignum"
import { REVENUE_STATUSES, countsAsRevenue } from "./dashboard"
import { zonedMidnightToUtc } from "./time"

/** The longest period one report covers (a leap year and a little); the previous period is as long again. */
export const MAX_DAYS = 400
const PAGE_SIZE = 500
const TOP = 5

/** Money per currency: never added across currencies, never converted. */
export type CurrencyNumbers = { currency_code: string; orders: number; revenue: number; average: number }

export type PeriodNumbers = {
  /** The first and the last day, both included, as the merchant's calendar shows them. */
  from: string
  to: string
  orders: number
  currencies: CurrencyNumbers[]
  /** Units sold in the orders of the period, and how many of them came back (received returns). */
  units: number
  returned_units: number
}

export type TopProduct = { product_id: string | null; title: string; units: number; revenue: { currency_code: string; amount: number }[] }

export type MedusifyReport = {
  timezone: string
  generated_at: string
  current: PeriodNumbers
  previous: PeriodNumbers
  /** The products with the most units sold in the current period (at most five). */
  top_products: TopProduct[]
}

type Day = { y: number; m: number; d: number }

function parseDay(text: string): Day {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!m) throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:bad_date")
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  const check = new Date(Date.UTC(day.y, day.m - 1, day.d))
  if (check.getUTCFullYear() !== day.y || check.getUTCMonth() !== day.m - 1 || check.getUTCDate() !== day.d) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:bad_date")
  }
  return day
}

/** Calendar arithmetic on days (no time zone involved: a day is a day on the merchant's calendar). */
function addDays(day: Day, n: number): Day {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const dayText = (day: Day) => `${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`
const dayNumber = (day: Day) => Date.UTC(day.y, day.m - 1, day.d) / 86_400_000
const startOf = (day: Day, tz: string) => zonedMidnightToUtc(day.y, day.m, day.d, tz)

/**
 * The two periods of a report: `from` to `to` (both included) and the same number of days right before it. Each day
 * starts at midnight in `tz`, so a day with a clock change is 23 or 25 hours long, as on the merchant's calendar.
 */
export function reportPeriods(from: string, to: string, tz: string) {
  const first = parseDay(from)
  const last = parseDay(to)
  const days = dayNumber(last) - dayNumber(first) + 1
  if (days < 1) throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:bad_period")
  if (days > MAX_DAYS) throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:period_too_long")
  const prevFirst = addDays(first, -days)
  const prevLast = addDays(first, -1)
  return {
    days,
    current: { from: dayText(first), to: dayText(last), start: startOf(first, tz), end: startOf(addDays(last, 1), tz) },
    previous: { from: dayText(prevFirst), to: dayText(prevLast), start: startOf(prevFirst, tz), end: startOf(first, tz) },
  }
}

type Sum = { orders: number; revenue: ReturnType<typeof toBN> }
type Acc = { orders: number; units: number; returned: number; currencies: Map<string, Sum> }
const emptyAcc = (): Acc => ({ orders: 0, units: 0, returned: 0, currencies: new Map() })

function finish(acc: Acc, period: { from: string; to: string }): PeriodNumbers {
  const currencies = [...acc.currencies.entries()]
    .map(([currency_code, s]) => {
      const revenue = s.revenue.toNumber()
      // the average in minor units, rounded like money: 100.005 is 100.01
      const average = s.orders > 0 ? Math.round((revenue / s.orders) * 100) / 100 : 0
      return { currency_code, orders: s.orders, revenue, average }
    })
    .sort((a, b) => a.currency_code.localeCompare(b.currency_code))
  return { from: period.from, to: period.to, orders: acc.orders, currencies, units: acc.units, returned_units: acc.returned }
}

type ReportLine = {
  product_id?: string | null
  product_title?: string | null
  title?: string | null
  quantity?: unknown
  total?: unknown
  detail?: { return_received_quantity?: unknown } | null
}

/**
 * The numbers of a period, read from Medusa's own order list (same statuses and totals as the admin order list):
 *  - an order counts when it is not canceled or a draft and its money is authorized or captured (as on the start
 *    screen, lib/dashboard.ts); its revenue is `summary.current_order_total`, so refunds are already taken off;
 *  - units are the quantities of its lines, returned units what came back in received returns;
 *  - a product's revenue is the total of its lines (after discounts, with tax), per currency.
 * Both periods are read in one pass: the previous period ends where the current one starts.
 */
export async function buildReport(container: MedusaContainer, input: { from: string; to: string; tz: string }, now = new Date()): Promise<MedusifyReport> {
  const p = reportPeriods(input.from, input.to, input.tz)
  const acc = { current: emptyAcc(), previous: emptyAcc() }
  const products = new Map<string, { product_id: string | null; title: string; units: number; revenue: Map<string, ReturnType<typeof toBN>> }>()

  for (let skip = 0; ; skip += PAGE_SIZE) {
    const { result } = await getOrdersListWorkflow(container).run({
      input: {
        fields: [
          "id",
          "created_at",
          "currency_code",
          "summary.current_order_total",
          // The order module computes line totals only when an order total is asked for too (shouldIncludeTotals checks
          // the top-level fields); "items.total" alone comes back empty.
          "total",
          "items.product_id",
          "items.product_title",
          "items.title",
          "items.quantity",
          "items.total",
          "items.detail.return_received_quantity",
        ],
        variables: {
          filters: { created_at: { $gte: p.previous.start.toISOString(), $lt: p.current.end.toISOString() }, status: REVENUE_STATUSES },
          skip,
          take: PAGE_SIZE,
          order: { created_at: "ASC", id: "ASC" },
        },
      },
    })
    const page = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? []) as Record<string, any>[]
    for (const order of page) {
      if (!countsAsRevenue(order.payment_status)) continue
      const current = new Date(order.created_at).getTime() >= p.current.start.getTime()
      const a = current ? acc.current : acc.previous
      const code = String(order.currency_code).toLowerCase()
      const sum = a.currencies.get(code) ?? { orders: 0, revenue: toBN(0) }
      sum.orders++
      sum.revenue = MathBN.add(sum.revenue, toBN(order.summary?.current_order_total))
      a.currencies.set(code, sum)
      a.orders++
      for (const line of (order.items ?? []) as ReportLine[]) {
        const units = toNumber(line.quantity as never)
        a.units += units
        a.returned += toNumber(line.detail?.return_received_quantity as never)
        if (!current) continue
        const title = line.product_title || line.title || "?"
        const id = line.product_id ?? null
        const key = id ?? `title:${title}`
        const top = products.get(key) ?? { product_id: id, title, units: 0, revenue: new Map() }
        top.units += units
        top.revenue.set(code, MathBN.add(top.revenue.get(code) ?? 0, toBN(line.total as never)))
        products.set(key, top)
      }
    }
    if (page.length < PAGE_SIZE) break
  }

  const top_products = [...products.values()]
    .sort((x, y) => y.units - x.units || x.title.localeCompare(y.title))
    .slice(0, TOP)
    .map((t) => ({
      product_id: t.product_id,
      title: t.title,
      units: t.units,
      revenue: [...t.revenue.entries()].map(([currency_code, amount]) => ({ currency_code, amount: amount.toNumber() })).sort((a, b) => a.currency_code.localeCompare(b.currency_code)),
    }))

  return {
    timezone: input.tz,
    generated_at: now.toISOString(),
    current: finish(acc.current, p.current),
    previous: finish(acc.previous, p.previous),
    top_products,
  }
}
