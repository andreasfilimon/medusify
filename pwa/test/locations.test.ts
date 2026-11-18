import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, fulfillmentLocations, shipOrder } from "../src/lib/api"
import { order, shop } from "./fixtures"

type Call = { url: string; method: string; body?: unknown }
const calls: Call[] = []

/** Answers by path. `routes` maps a path prefix to a JSON body (or a status number for an error). */
function stubShop(routes: Record<string, unknown>) {
  calls.length = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace("https://a", "")
      calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined })
      const hit = Object.keys(routes).find((p) => path.startsWith(p))
      if (!hit) return new Response(JSON.stringify({ message: `no route ${path}` }), { status: 500 })
      const answer = routes[hit]
      if (typeof answer === "number") return new Response(JSON.stringify({ message: "x" }), { status: answer })
      return new Response(JSON.stringify(answer), { status: 200 })
    }),
  )
}
afterEach(() => vi.unstubAllGlobals())

const home = shop("a", { home: true })
/** What the shop answers when the order is read for the location choice (`fulfillmentLocations` takes only its id). */
const fullOrder = (extra = {}) => ({ order: { ...order("o1"), sales_channel_id: "sc_1", shipping_methods: [{ shipping_option_id: "so_1" }], items: [{ id: "li_1", quantity: 1, detail: { fulfilled_quantity: 0 } }], fulfillments: [], ...extra } })
const locations = (...l: [string, string][]) => ({ stock_locations: l.map(([id, name]) => ({ id, name })) })

// The callers hand over the entry of the order list: only its id counts, the shipping data is read by the function itself.
const listEntry = order("o1")
const noMethod = { "/admin/orders/o1?": fullOrder({ shipping_methods: [] }) }
const option = (id: string, name: string) => ({ shipping_option: { id: "so_1", service_zone: { fulfillment_set: { location: { id, name } } } } })

describe("fulfillmentLocations", () => {
  it("takes the location of the order's shipping option, as the Medusa dashboard does", async () => {
    stubShop({
      "/admin/orders/o1?": fullOrder(),
      "/admin/shipping-options/so_1": option("sloc_b", "Wien"),
      "/admin/stock-locations": locations(["sloc_a", "Graz"], ["sloc_b", "Wien"]),
    })
    expect(await fulfillmentLocations(home, listEntry)).toEqual([{ id: "sloc_b", name: "Wien" }])
    expect(calls.some((c) => c.url.startsWith("/admin/stock-locations"))).toBe(false)
  })

  it("reads the order itself: an order list entry has no shipping methods and must not lead to all locations", async () => {
    stubShop({
      "/admin/orders/o1?": fullOrder(),
      "/admin/shipping-options/so_1": option("sloc_wien", "Wien"),
      "/admin/stock-locations": locations(["sloc_graz", "Graz"], ["sloc_wien", "Wien"]),
    })
    // Graz sorts first: with the old fallback to the whole list, this would have been the preselected location.
    expect((await fulfillmentLocations(home, listEntry)).map((l) => l.id)).toEqual(["sloc_wien"])
    expect(calls[0]?.url).toContain("/admin/orders/o1?")
  })

  it("without a usable shipping option it lists the locations of the order's sales channel, in a fixed order", async () => {
    stubShop({
      "/admin/orders/o1?": fullOrder(),
      "/admin/shipping-options/so_1": 404,
      "/admin/stock-locations": locations(["sloc_z", "Wien"], ["sloc_b", "Graz"], ["sloc_a", "Graz"]),
    })
    // the API answers in any order; the result must not depend on it: by name, then by id
    expect((await fulfillmentLocations(home, listEntry)).map((l) => l.id)).toEqual(["sloc_a", "sloc_b", "sloc_z"])
    expect(calls.find((c) => c.url.startsWith("/admin/stock-locations"))?.url).toContain("sales_channel_id=sc_1")
  })

  it("an order without shipping method goes straight to the list", async () => {
    stubShop({ ...noMethod, "/admin/stock-locations": locations(["sloc_b", "B"], ["sloc_a", "A"]) })
    const res = await fulfillmentLocations(home, listEntry)
    expect(res.map((l) => l.id)).toEqual(["sloc_a", "sloc_b"])
    expect(calls.some((c) => c.url.startsWith("/admin/shipping-options"))).toBe(false)
  })

  it("falls back to all locations when none is linked to the sales channel", async () => {
    let n = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/admin/orders/o1?")) return new Response(JSON.stringify(fullOrder()), { status: 200 })
        if (url.includes("/admin/shipping-options")) return new Response("{}", { status: 404 })
        n++
        return new Response(JSON.stringify(url.includes("sales_channel_id") ? { stock_locations: [] } : locations(["sloc_a", "A"])), { status: 200 })
      }),
    )
    expect((await fulfillmentLocations(home, listEntry)).map((l) => l.id)).toEqual(["sloc_a"])
    expect(n).toBe(2)
  })

  it("no location at all is an error, not a guess", async () => {
    stubShop({ ...noMethod, "/admin/stock-locations": { stock_locations: [] } })
    await expect(fulfillmentLocations(home, listEntry)).rejects.toBeInstanceOf(ApiError)
  })

  it("a lost connection is not hidden as 'no location'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))))
    await expect(fulfillmentLocations(home, listEntry)).rejects.toMatchObject({ kind: "network" })
  })

  describe("a fulfillment waits for its shipment and nothing is left to fulfill (retry after a failure in between)", () => {
    const done = [{ id: "li_1", quantity: 1, detail: { fulfilled_quantity: 1, shipped_quantity: 0 } }]
    const routes = (fulfillments: unknown[]) => ({
      "/admin/orders/o1?": fullOrder({ items: done, fulfillments }),
      "/admin/shipping-options/so_1": option("sloc_wien", "Wien"),
      "/admin/stock-locations": locations(["sloc_graz", "Graz"], ["sloc_wien", "Wien"]),
    })

    it("offers only the location of that fulfillment, since a choice would have no effect", async () => {
      stubShop(routes([{ id: "ful_1", location_id: "sloc_graz", shipped_at: null, canceled_at: null }]))
      expect((await fulfillmentLocations(home, listEntry)).map((l) => l.id)).toEqual(["sloc_graz"])
      expect(calls.some((c) => c.url.startsWith("/admin/stock-locations") || c.url.startsWith("/admin/shipping-options"))).toBe(false)
    })

    it("a shipped or canceled fulfillment does not fix anything", async () => {
      stubShop(routes([{ id: "ful_1", location_id: "sloc_graz", shipped_at: "2026-11-16T10:00:00Z" }, { id: "ful_2", location_id: "sloc_graz", canceled_at: "2026-11-16T10:00:00Z" }]))
      expect((await fulfillmentLocations(home, listEntry)).map((l) => l.id)).toEqual(["sloc_wien"])
    })

    it("with lines still to fulfill the location is a real choice again", async () => {
      stubShop({ ...routes([{ id: "ful_1", location_id: "sloc_graz" }]), "/admin/orders/o1?": fullOrder({ items: [{ id: "li_1", quantity: 2, detail: { fulfilled_quantity: 1 } }], fulfillments: [{ id: "ful_1", location_id: "sloc_graz" }], shipping_methods: [] }) })
      expect((await fulfillmentLocations(home, listEntry)).map((l) => l.id)).toEqual(["sloc_graz", "sloc_wien"])
    })
  })
})

describe("shipOrder picks the location", () => {
  const unfulfilled = {
    order: { ...order("o1"), items: [{ id: "li_1", quantity: 1, detail: { fulfilled_quantity: 0, shipped_quantity: 0 } }], fulfillments: [], shipping_methods: [] },
  }
  const fulfilled = {
    order: { ...order("o1"), items: [{ id: "li_1", quantity: 1, detail: { fulfilled_quantity: 1, shipped_quantity: 0 } }], fulfillments: [{ id: "ful_1" }], shipping_methods: [] },
  }

  function stubFlow(stockLocations: unknown) {
    calls.length = 0
    let read = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://a", "")
        calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined })
        if (path.startsWith("/admin/stock-locations")) return new Response(JSON.stringify(stockLocations), { status: 200 })
        if (path.startsWith("/admin/orders/o1?")) return new Response(JSON.stringify(read++ === 0 ? unfulfilled : fulfilled), { status: 200 })
        return new Response("{}", { status: 200 })
      }),
    )
  }
  const fulfillmentPost = () => calls.find((c) => c.method === "POST" && c.url.endsWith("/fulfillments"))

  it("uses the location the user chose", async () => {
    stubFlow(locations(["sloc_a", "A"], ["sloc_b", "B"]))
    await shipOrder(home, order("o1"), { tracking_number: "T1", notify: false, location_id: "sloc_b" })
    expect((fulfillmentPost()?.body as { location_id: string }).location_id).toBe("sloc_b")
  })

  it("with several locations and no choice it takes the same one every time, not whatever the API lists first", async () => {
    stubFlow(locations(["sloc_z", "Wien"], ["sloc_a", "Graz"]))
    await shipOrder(home, order("o1"), { tracking_number: "T1", notify: false })
    expect((fulfillmentPost()?.body as { location_id: string }).location_id).toBe("sloc_a")
  })
})

describe("shipOrder with more than one open fulfillment", () => {
  // An older fulfillment (packed in the Medusa admin) holds li_1, the one created by the app holds li_2.
  const lines = [
    { id: "li_1", quantity: 1, detail: { fulfilled_quantity: 1, shipped_quantity: 0 } },
    { id: "li_2", quantity: 2, detail: { fulfilled_quantity: 2, shipped_quantity: 0 } },
  ]
  const fulfillments = [
    { id: "ful_old", location_id: "sloc_a", shipped_at: null, canceled_at: null, items: [{ line_item_id: "li_1", quantity: 1 }] },
    { id: "ful_new", location_id: "sloc_a", shipped_at: null, canceled_at: null, items: [{ line_item_id: "li_2", quantity: 2 }] },
  ]

  it("ships each fulfillment with its own lines, not all lines on the newest one", async () => {
    calls.length = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://a", "")
        calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined })
        if (path.startsWith("/admin/orders/o1?")) return new Response(JSON.stringify({ order: { ...order("o1"), items: lines, fulfillments, shipping_methods: [] } }), { status: 200 })
        return new Response("{}", { status: 200 })
      }),
    )
    await shipOrder(home, order("o1"), { tracking_number: "T1", notify: false })
    const shipments = calls.filter((c) => c.method === "POST" && c.url.endsWith("/shipments"))
    expect(shipments.map((c) => [c.url, (c.body as { items: unknown[] }).items])).toEqual([
      ["/admin/orders/o1/fulfillments/ful_old/shipments", [{ id: "li_1", quantity: 1 }]],
      ["/admin/orders/o1/fulfillments/ful_new/shipments", [{ id: "li_2", quantity: 2 }]],
    ])
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/fulfillments"))).toBe(false)
  })
})
