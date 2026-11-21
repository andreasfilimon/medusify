import type { MedusaContainer } from "@medusajs/framework/types"
import { MathBN, MedusaError, Modules } from "@medusajs/framework/utils"
import { getOrdersListWorkflow } from "@medusajs/medusa/core-flows"
import { toBN } from "./bignum"
import { REVENUE_STATUSES, countsAsRevenue, type RevenueByCurrency } from "./dashboard"

/**
 * What the app shows about a customer next to the name: how many orders, how much was spent and when the last order
 * came. The same rule as the dashboard: orders that are canceled or drafts do not count, and "spent" adds up
 * `current_order_total` (refunds and returns already taken off) of the orders whose payment is authorized or captured,
 * per currency, never mixed.
 */
export type CustomerStats = {
  orders: number
  spent: RevenueByCurrency
  last_order_at: string | null
  /**
   * The name on the shipping address of the newest order. A guest from the checkout has only an email on the customer
   * (Medusa's find-or-create-customer stores nothing else), the name is on the order.
   */
  order_name: string | null
}

export type CustomerView = {
  id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  company_name: string | null
  phone: string | null
  /** A registered account; false for a guest who only left an email at checkout. */
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

type RawCustomer = {
  id: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  phone?: string | null
  has_account?: boolean | null
  created_at: string | Date
  addresses?: Partial<CustomerAddress>[] | null
  groups?: { id: string; name?: string | null }[] | null
}

type CustomerModule = {
  listAndCountCustomers(filters: Record<string, unknown>, config: Record<string, unknown>): Promise<[RawCustomer[], number]>
  listCustomers(filters: Record<string, unknown>, config: Record<string, unknown>): Promise<RawCustomer[]>
}

const STATS_PAGE = 500
const EMPTY: CustomerStats = { orders: 0, spent: [], last_order_at: null, order_name: null }

/** Order numbers per customer, read through Medusa's own order list (it aggregates the payment status). */
export async function statsOf(container: MedusaContainer, customerIds: readonly string[]): Promise<Map<string, CustomerStats>> {
  const out = new Map<string, { orders: number; spent: Map<string, ReturnType<typeof toBN>>; last: number | null; name: string | null }>()
  if (customerIds.length === 0) return new Map()
  for (let skip = 0; ; skip += STATS_PAGE) {
    const { result } = await getOrdersListWorkflow(container).run({
      input: {
        fields: ["id", "customer_id", "created_at", "currency_code", "summary.current_order_total", "shipping_address.first_name", "shipping_address.last_name"],
        variables: { filters: { customer_id: [...customerIds], status: REVENUE_STATUSES }, skip, take: STATS_PAGE, order: { created_at: "ASC", id: "ASC" } },
      },
    })
    const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Record<string, any>[]
    for (const order of rows) {
      const id = String(order.customer_id)
      const s = out.get(id) ?? { orders: 0, spent: new Map(), last: null, name: null }
      s.orders++
      const at = new Date(order.created_at).getTime()
      const name = [order.shipping_address?.first_name, order.shipping_address?.last_name].filter(Boolean).join(" ").trim()
      // oldest first: a later order's name wins
      if (name) s.name = name
      s.last = s.last === null ? at : Math.max(s.last, at)
      if (countsAsRevenue(order.payment_status)) {
        const code = String(order.currency_code).toLowerCase()
        s.spent.set(code, MathBN.add(s.spent.get(code) ?? 0, toBN(order.summary?.current_order_total)))
      }
      out.set(id, s)
    }
    if (rows.length < STATS_PAGE) break
  }
  return new Map(
    [...out.entries()].map(([id, s]) => [
      id,
      {
        orders: s.orders,
        spent: [...s.spent.entries()].map(([currency_code, amount]) => ({ currency_code, amount: amount.toNumber() })).sort((a, b) => a.currency_code.localeCompare(b.currency_code)),
        last_order_at: s.last === null ? null : new Date(s.last).toISOString(),
        order_name: s.name,
      },
    ])
  )
}

const iso = (d: string | Date) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString())

function toView(c: RawCustomer, stats: CustomerStats | undefined): CustomerView {
  return {
    id: c.id,
    email: c.email ?? null,
    first_name: c.first_name ?? null,
    last_name: c.last_name ?? null,
    company_name: c.company_name ?? null,
    phone: c.phone ?? null,
    has_account: !!c.has_account,
    created_at: iso(c.created_at),
    stats: stats ?? EMPTY,
  }
}

const SELECT = ["id", "email", "first_name", "last_name", "company_name", "phone", "has_account", "created_at"]

/** GET /admin/medusify/customers: newest first, `q` searches name, email, company and phone (Medusa's searchable fields). */
export async function listCustomers(container: MedusaContainer, input: { q?: string; offset: number; limit: number }): Promise<{ customers: CustomerView[]; count: number }> {
  const customers = container.resolve(Modules.CUSTOMER) as unknown as CustomerModule
  const [rows, count] = await customers.listAndCountCustomers(input.q ? { q: input.q } : {}, {
    select: SELECT,
    skip: input.offset,
    take: input.limit,
    order: { created_at: "DESC", id: "DESC" },
  })
  const stats = await statsOf(container, rows.map((c) => c.id))
  return { customers: rows.map((c) => toView(c, stats.get(c.id))), count }
}

/** GET /admin/medusify/customers/:id: the customer with addresses, groups and the same numbers. */
export async function getCustomer(container: MedusaContainer, id: string): Promise<CustomerDetail> {
  const customers = container.resolve(Modules.CUSTOMER) as unknown as CustomerModule
  const [c] = await customers.listCustomers({ id }, { select: SELECT, relations: ["addresses", "groups"], take: 1 })
  if (!c) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_customer")
  const stats = await statsOf(container, [c.id])
  return {
    ...toView(c, stats.get(c.id)),
    addresses: (c.addresses ?? []).map((a) => ({
      id: String(a.id),
      first_name: a.first_name ?? null,
      last_name: a.last_name ?? null,
      company: a.company ?? null,
      address_1: a.address_1 ?? null,
      address_2: a.address_2 ?? null,
      postal_code: a.postal_code ?? null,
      city: a.city ?? null,
      province: a.province ?? null,
      country_code: a.country_code ?? null,
      phone: a.phone ?? null,
      is_default_shipping: !!a.is_default_shipping,
      is_default_billing: !!a.is_default_billing,
    })),
    groups: (c.groups ?? []).map((g) => ({ id: g.id, name: g.name ?? "" })),
  }
}
