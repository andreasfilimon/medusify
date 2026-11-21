import { formatMoney, type Lang } from "./format"

/** The plugin's answer (plugin/src/lib/customers.ts). Amounts in the currency's main unit, per currency, never mixed. */
export type CustomerStats = {
  orders: number
  spent: { currency_code: string; amount: number }[]
  last_order_at: string | null
  /** The name on the newest order: a guest from the checkout has only an email on the customer. Older plugins send none. */
  order_name?: string | null
}

export type CustomerView = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  phone: string | null
  has_account: boolean
  created_at: string
  stats: CustomerStats
}

export type CustomerAddress = {
  id: string
  first_name: string | null
  last_name: string | null
  company: string | null
  address_1: string | null
  address_2: string | null
  postal_code: string | null
  city: string | null
  province: string | null
  country_code: string | null
  phone: string | null
  is_default_shipping: boolean
  is_default_billing: boolean
}

export type CustomerDetail = CustomerView & { addresses: CustomerAddress[]; groups: { id: string; name: string }[] }
export type CustomerPage = { customers: CustomerView[]; count: number; offset: number; limit: number }

/** The name to show: first and last name, else the company, else the name on the newest order, else the email. */
export function customerTitle(c: Pick<CustomerView, "first_name" | "last_name" | "company_name" | "email" | "stats">): string {
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim()
  return name || c.company_name?.trim() || c.stats.order_name?.trim() || c.email || "-"
}

/** What a customer spent, one amount per currency ("1.240,00 € · 80,00 $"); empty when nothing was paid. */
export function spentText(stats: CustomerStats, lang: Lang): string {
  return stats.spent.map((s) => formatMoney(s.amount, s.currency_code, lang)).join(" · ")
}

/** An address as lines, the way an envelope reads. */
export function addressLines(a: CustomerAddress): string[] {
  return [
    [a.first_name, a.last_name].filter(Boolean).join(" "),
    a.company,
    a.address_1,
    a.address_2,
    [a.postal_code, a.city].filter(Boolean).join(" "),
    [a.province, a.country_code?.toUpperCase()].filter(Boolean).join(", "),
  ].filter((l): l is string => !!l && l.trim().length > 0)
}
