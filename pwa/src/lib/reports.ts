import { localeOf, type Lang } from "./format"

/** What GET /admin/medusify/reports answers (plugin 0.5.0, plugin/src/lib/report.ts). */
export type ReportCurrency = { currency_code: string; orders: number; revenue: number; average: number }
export type ReportPeriod = { from: string; to: string; orders: number; currencies: ReportCurrency[]; units: number; returned_units: number }
export type Report = {
  timezone: string
  generated_at: string
  current: ReportPeriod
  previous: ReportPeriod
  top_products: { product_id: string | null; title: string; units: number; revenue: { currency_code: string; amount: number }[] }[]
}

export type RangeKind = "7d" | "30d" | "month" | "custom"
export type Range = { from: string; to: string }

/** The same limit the plugin has (plugin/src/lib/report.ts, MAX_DAYS). */
export const MAX_DAYS = 400

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, "0")

/** The calendar day of `now` on the clock of `tz`, as YYYY-MM-DD. */
export function dayIn(now: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return `${get("year")}-${pad(get("month"))}-${pad(get("day"))}`
}

const toUtc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))
const fromUtc = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * DAY_MS)
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1

/** The period a choice stands for, ending today: the last 7 or 30 days, or this month so far. */
export function rangeFor(kind: Exclude<RangeKind, "custom">, today: string): Range {
  if (kind === "month") return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: addDays(today, kind === "7d" ? -6 : -29), to: today }
}

/** Why a period typed by hand cannot be asked for, or null when it can. */
export function rangeProblem(r: Range): "order" | "long" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.from) || !/^\d{4}-\d{2}-\d{2}$/.test(r.to)) return "order"
  const days = daysBetween(r.from, r.to)
  if (days < 1) return "order"
  if (days > MAX_DAYS) return "long"
  return null
}

/** "1.–7. März" / "Mar 1 – 7"; across months or years the full dates. The days are calendar days, so read as UTC. */
export function rangeText(r: Range, lang: Lang): string {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(localeOf(lang), { ...o, timeZone: "UTC" })
  const a = new Date(toUtc(r.from))
  const b = new Date(toUtc(r.to))
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear()
  const opts: Intl.DateTimeFormatOptions = sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }
  if (r.from === r.to) return f(opts).format(a)
  return f(opts).formatRange(a, b)
}

/** How a number moved against the period before. `pct` is whole percent; `new` = nothing before, `none` = nothing either time. */
export type Change = { kind: "up" | "down" | "same"; pct: number } | { kind: "new" } | { kind: "none" }

export function change(current: number, previous: number): Change {
  if (previous === 0) return current === 0 ? { kind: "none" } : { kind: "new" }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return { kind: "same", pct: 0 }
  return { kind: pct > 0 ? "up" : "down", pct: Math.abs(pct) }
}

/** Revenue rows of both periods side by side, per currency; a currency of only one period still gets its row. */
export function currencyRows(report: Report): { code: string; now: ReportCurrency | null; before: ReportCurrency | null }[] {
  const codes = [...new Set([...report.current.currencies, ...report.previous.currencies].map((c) => c.currency_code))].sort()
  return codes.map((code) => ({
    code,
    now: report.current.currencies.find((c) => c.currency_code === code) ?? null,
    before: report.previous.currencies.find((c) => c.currency_code === code) ?? null,
  }))
}

/** Share of the sold units that came back, in percent with one decimal; null when nothing was sold. */
export function returnRate(p: ReportPeriod): number | null {
  if (p.units <= 0) return null
  return Math.round((p.returned_units / p.units) * 1000) / 10
}
