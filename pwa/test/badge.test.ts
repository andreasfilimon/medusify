import { beforeEach, describe, expect, it, vi } from "vitest"
import sw from "../public/sw.js?raw"
import { badgeSupported, badgeTotal, clearBadge, mergeCounts, readCounts, setBadge, syncBadge } from "../src/lib/badge"

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("medusify-badge")
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
})

const nav = () => ({ setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) })

describe("badge numbers", () => {
  it("adds up what is to ship over all shops and ignores junk", () => {
    expect(badgeTotal({ a: { label: "A", n: 3 }, b: { label: "B", n: 2 }, c: { label: "C", n: -4 }, d: { label: "D", n: Number.NaN } })).toBe(5)
    expect(badgeTotal({})).toBe(0)
  })
  it("a fresh number replaces the old one, a silent shop keeps its last, a removed shop drops out", () => {
    const prev = { a: { label: "A", n: 1 }, b: { label: "B", n: 7 }, gone: { label: "G", n: 9 }, "push:X": { label: "X", n: 4 } }
    expect(mergeCounts(prev, [{ id: "a", label: "A", n: 5 }], ["a", "b"])).toEqual({ a: { label: "A", n: 5 }, b: { label: "B", n: 7 } })
  })
})

describe("setting the icon number", () => {
  it("uses the Badging API when it exists and clears at zero", async () => {
    const n = nav()
    await setBadge(4, n)
    expect(n.setAppBadge).toHaveBeenCalledWith(4)
    await setBadge(0, n)
    expect(n.clearAppBadge).toHaveBeenCalled()
  })
  it("does nothing, and does not throw, where the API is missing", async () => {
    expect(badgeSupported({})).toBe(false)
    await expect(setBadge(3, {})).resolves.toBeUndefined()
  })
  it("swallows a refused badge", async () => {
    await expect(setBadge(3, { setAppBadge: async () => Promise.reject(new Error("denied")) })).resolves.toBeUndefined()
  })
})

describe("sync from the open app", () => {
  it("stores every shop and shows the sum, not one shop's number", async () => {
    const n = nav()
    const total = await syncBadge([{ id: "s1", label: "Alpha", n: 3 }, { id: "s2", label: "Beta", n: 2 }], ["s1", "s2"], n)
    expect(total).toBe(5)
    expect(n.setAppBadge).toHaveBeenLastCalledWith(5)
    expect(await readCounts()).toEqual({ s1: { label: "Alpha", n: 3 }, s2: { label: "Beta", n: 2 } })
  })
  it("a shop that did not answer keeps its last number", async () => {
    const n = nav()
    await syncBadge([{ id: "s1", label: "Alpha", n: 3 }, { id: "s2", label: "Beta", n: 2 }], ["s1", "s2"], n)
    expect(await syncBadge([{ id: "s1", label: "Alpha", n: 1 }], ["s1", "s2"], n)).toBe(3)
  })
  it("no shops left clears the icon", async () => {
    const n = nav()
    await syncBadge([{ id: "s1", label: "Alpha", n: 3 }], ["s1"], n)
    expect(await syncBadge([], [], n)).toBe(0)
    expect(n.clearAppBadge).toHaveBeenCalled()
    await clearBadge(n)
    expect(await readCounts()).toEqual({})
  })
})

// ---- the service worker, run for real against a fake worker scope --------------------------------------------

type Handler = (event: unknown) => void
function worker(navigatorStub: object | undefined) {
  const handlers: Record<string, Handler> = {}
  const shown: { title: string; options: unknown }[] = []
  const self = {
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    registration: { showNotification: vi.fn(async (title: string, options: unknown) => void shown.push({ title, options })) },
    location: { origin: "https://shop.example.invalid" },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    skipWaiting: () => {},
    navigator: navigatorStub,
  }
  new Function("self", "caches", "indexedDB", "fetch", sw)(self, { open: async () => ({ add: async () => {} }), keys: async () => [], delete: async () => true, match: async () => undefined }, indexedDB, async () => new Response())
  const push = async (payload: unknown) => {
    const waits: Promise<unknown>[] = []
    handlers.push!({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
  }
  return { push, self, shown }
}
const pushOf = (shop: string, badge?: number) => ({ title: `${shop}: Neue Bestellung #1`, body: "x", data: { url: "/medusify/orders/o1", kind: "order_placed", shop, ...(badge === undefined ? {} : { badge }) } })

describe("service worker: number on the icon after a push", () => {
  it("replaces the number of the shop that pushed and keeps the others", async () => {
    const n = nav()
    await syncBadge([{ id: "s1", label: "Alpha", n: 3 }, { id: "s2", label: "Beta", n: 2 }], ["s1", "s2"], n)
    const w = worker(n)
    await w.push(pushOf("Alpha", 6))
    expect(n.setAppBadge).toHaveBeenLastCalledWith(8)
    expect(w.shown).toHaveLength(1)
    expect((await readCounts()).s2).toEqual({ label: "Beta", n: 2 })
  })
  it("two pushes in a row both count", async () => {
    const n = nav()
    await syncBadge([{ id: "s1", label: "Alpha", n: 0 }, { id: "s2", label: "Beta", n: 0 }], ["s1", "s2"], n)
    const w = worker(n)
    await Promise.all([w.push(pushOf("Alpha", 2)), w.push(pushOf("Beta", 3))])
    expect(badgeTotal(await readCounts())).toBe(5)
  })
  it("a shop the app has not listed yet is added, and the app drops it again on its next sync", async () => {
    const n = nav()
    await syncBadge([{ id: "s1", label: "Alpha", n: 1 }], ["s1"], n)
    await worker(n).push(pushOf("Gamma", 4))
    expect(n.setAppBadge).toHaveBeenLastCalledWith(5)
    await syncBadge([{ id: "s1", label: "Alpha", n: 1 }], ["s1"], n)
    expect(badgeTotal(await readCounts())).toBe(1)
  })
  it("two shops with one label cannot be told apart: the icon stays", async () => {
    const n = nav()
    await syncBadge([{ id: "s1", label: "Shop", n: 3 }, { id: "s2", label: "Shop", n: 2 }], ["s1", "s2"], n)
    n.setAppBadge.mockClear()
    await worker(n).push(pushOf("Shop", 9))
    expect(await readCounts()).toEqual({ s1: { label: "Shop", n: 3 }, s2: { label: "Shop", n: 2 } })
  })
  it("zero to ship clears the icon", async () => {
    const n = nav()
    await syncBadge([{ id: "s1", label: "Alpha", n: 1 }], ["s1"], n)
    await worker(n).push(pushOf("Alpha", 0))
    expect(n.clearAppBadge).toHaveBeenCalled()
  })
  it("a push without a number leaves the icon alone but still shows the notification", async () => {
    const n = nav()
    const w = worker(n)
    await w.push(pushOf("Alpha"))
    expect(n.setAppBadge).not.toHaveBeenCalled()
    expect(w.shown).toHaveLength(1)
  })
  it("without the Badging API the notification still shows", async () => {
    const w = worker({})
    await w.push(pushOf("Alpha", 3))
    expect(w.shown).toHaveLength(1)
    expect(await readCounts()).toEqual({}) // the feature check comes first: no number is kept for an icon that cannot show it
  })
  it("a failing store or a refused badge never costs the notification", async () => {
    const refusing = { setAppBadge: vi.fn(async () => Promise.reject(new Error("denied"))), clearAppBadge: vi.fn() }
    const w = worker(refusing)
    await w.push(pushOf("Alpha", 3))
    expect(w.shown).toHaveLength(1)
  })
})
