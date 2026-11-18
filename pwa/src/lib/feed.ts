import type { OrderQuery } from "./api"
import { matchesFilter, type OrderFilter } from "./orders"
import type { Order, Shop, ShopOrder } from "./types"

/** Per shop: next offset, or null once the shop has nothing more. */
export type FeedCursor = Record<string, number | null>

export type FeedPage = {
  items: ShopOrder[]
  cursor: FeedCursor
  /** Shops that did not answer for this page. */
  failed: string[]
  done: boolean
}

export type ListFn = (shop: Shop, query: OrderQuery) => Promise<{ orders: Order[]; count: number }>

/** A page is "full enough" at this many visible rows; below it the feed keeps loading (client-side filter). */
export const TARGET_ROWS = 20
const MAX_ROUNDS = 6
const PAGE = 50

export function initialCursor(shops: Shop[]): FeedCursor {
  return Object.fromEntries(shops.map((s) => [s.id, 0]))
}

export const byNewest = (a: ShopOrder, b: ShopOrder) => new Date(b.order.created_at).getTime() - new Date(a.order.created_at).getTime()

/**
 * Loads the next rows of the order list across the given shops. Medusa filters only by status, so open and
 * shipped are derived here from the computed fulfillment status. A shop that fails is reported, not retried
 * inside the page; the other shops still show.
 */
export async function loadFeedPage(
  shops: Shop[],
  from: FeedCursor,
  opts: { filter: OrderFilter; q: string },
  list: ListFn,
): Promise<FeedPage> {
  const cursor: FeedCursor = { ...from }
  const items: ShopOrder[] = []
  const failed = new Set<string>()
  const scope = opts.filter === "canceled" ? "canceled" : opts.filter === "all" ? "any" : "active"

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const live = shops.filter((s) => typeof cursor[s.id] === "number" && !failed.has(s.id))
    if (live.length === 0) break
    const results = await Promise.allSettled(live.map((s) => list(s, { offset: cursor[s.id] as number, q: opts.q || undefined, scope })))
    results.forEach((res, i) => {
      const shop = live[i]!
      if (res.status === "rejected") {
        failed.add(shop.id)
        cursor[shop.id] = null
        return
      }
      const { orders, count } = res.value
      const next = (cursor[shop.id] as number) + orders.length
      cursor[shop.id] = orders.length < PAGE || next >= count ? null : next
      for (const order of orders) if (matchesFilter(order, opts.filter)) items.push({ shop, order })
    })
    if (items.length >= TARGET_ROWS) break
  }
  items.sort(byNewest)
  return { items, cursor, failed: [...failed], done: Object.values(cursor).every((v) => v === null) }
}

/** Order ids are only unique per shop, so rows are keyed by both. */
export const rowKey = (x: ShopOrder<Pick<Order, "id">>) => `${x.shop.id}:${x.order.id}`
