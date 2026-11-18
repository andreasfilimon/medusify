import { describe, expect, it } from "vitest"
import { initialCursor, loadFeedPage, rowKey, TARGET_ROWS, type ListFn } from "../src/lib/feed"
import { order, shop } from "./fixtures"

const many = (prefix: string, n: number, over = {}) => Array.from({ length: n }, (_, i) => order(`${prefix}${i}`, { created_at: new Date(Date.UTC(2026, 10, 16, 10, 0, i)).toISOString(), ...over }))

describe("loadFeedPage", () => {
  it("merges shops newest first and keys rows by shop and order", async () => {
    const a = shop("a")
    const b = shop("b")
    const list: ListFn = async (s) => ({ orders: s.id === "a" ? [order("x", { created_at: "2026-11-16T09:00:00Z" })] : [order("x", { created_at: "2026-11-16T10:00:00Z" })], count: 1 })
    const page = await loadFeedPage([a, b], initialCursor([a, b]), { filter: "all", q: "" }, list)
    expect(page.items.map(rowKey)).toEqual(["b:x", "a:x"])
    expect(page.done).toBe(true)
  })
  it("keeps loading until enough rows pass the client-side filter", async () => {
    const a = shop("a")
    const calls: number[] = []
    const list: ListFn = async (_s, q) => {
      calls.push(q.offset)
      // first page: only shipped orders, second page: 50 open ones
      return q.offset === 0 ? { orders: many("s", 50, { fulfillment_status: "shipped" }), count: 100 } : { orders: many("o", 50), count: 100 }
    }
    const page = await loadFeedPage([a], initialCursor([a]), { filter: "open", q: "" }, list)
    expect(calls).toEqual([0, 50])
    expect(page.items.length).toBe(50)
    expect(page.items.length).toBeGreaterThanOrEqual(TARGET_ROWS)
    expect(page.done).toBe(true)
  })
  it("reports a failing shop and still shows the others", async () => {
    const a = shop("a")
    const b = shop("b")
    const list: ListFn = async (s) => {
      if (s.id === "b") throw new Error("down")
      return { orders: [order("1")], count: 1 }
    }
    const page = await loadFeedPage([a, b], initialCursor([a, b]), { filter: "all", q: "" }, list)
    expect(page.failed).toEqual(["b"])
    expect(page.items.map(rowKey)).toEqual(["a:1"])
  })
  it("passes the scope for the filter to the shop", async () => {
    const a = shop("a")
    const seen: string[] = []
    const list: ListFn = async (_s, q) => {
      seen.push(q.scope)
      return { orders: [], count: 0 }
    }
    for (const filter of ["open", "shipped", "canceled", "all"] as const) await loadFeedPage([a], initialCursor([a]), { filter, q: "" }, list)
    expect(seen).toEqual(["active", "active", "canceled", "any"])
  })
})
