import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError, fulfillmentLocations, labelsFor, shipOrder } from "../src/lib/api"
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
        // A plugin older than 0.2.2 has no ship route: the app makes Medusa's calls itself.
        if (path.includes("/medusify/orders/o1/ship")) return new Response("Cannot POST", { status: 404 })
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
        if (path.includes("/medusify/orders/o1/ship")) return new Response("Cannot POST", { status: 404 })
        if (path.startsWith("/admin/orders/o1?")) return new Response(JSON.stringify({ order: { ...order("o1"), items: lines, fulfillments, shipping_methods: [] } }), { status: 200 })
        return new Response("{}", { status: 200 })
      }),
    )
    // One number cannot belong to both packages: refused before any shipment.
    await expect(shipOrder(home, order("o1"), { tracking_number: "T1", notify: false })).rejects.toMatchObject({ message: "medusify:numbers_required" })
    expect(calls.some((c) => c.url.endsWith("/shipments"))).toBe(false)
    calls.length = 0
    await shipOrder(home, order("o1"), { notify: false, numbers: { ful_old: "N-OLD", ful_new: "N-NEW" } })
    const shipments = calls.filter((c) => c.method === "POST" && c.url.endsWith("/shipments"))
    expect(shipments.map((c) => (c.body as { labels: { tracking_number: string }[] }).labels.map((l) => l.tracking_number))).toEqual([["N-OLD"], ["N-NEW"]])
    expect(shipments.map((c) => [c.url, (c.body as { items: unknown[] }).items])).toEqual([
      ["/admin/orders/o1/fulfillments/ful_old/shipments", [{ id: "li_1", quantity: 1 }]],
      ["/admin/orders/o1/fulfillments/ful_new/shipments", [{ id: "li_2", quantity: 2 }]],
    ])
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/fulfillments"))).toBe(false)
  })
})

describe("shipOrder through the plugin's ship route", () => {
  function stubRoute(answer: number | object, orderBody?: object) {
    calls.length = 0
    const inits: RequestInit[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://a", "")
        inits.push(init)
        calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined })
        if (path.includes("/medusify/orders/o1/ship")) return typeof answer === "number" ? new Response(JSON.stringify({ message: "x" }), { status: answer }) : new Response(JSON.stringify(answer), { status: 200 })
        if (path.startsWith("/admin/orders/o1?") && orderBody) return new Response(JSON.stringify(orderBody), { status: 200 })
        return new Response("{}", { status: 200 })
      }),
    )
    return inits
  }

  it("makes one call with the numbers, and no call of its own to Medusa", async () => {
    const inits = stubRoute({ order_id: "o1", shipped: [], delivered: [], nothing_to_do: false })
    await shipOrder(home, order("o1"), { tracking_number: " AT1 ", tracking_url: "https://t.invalid/AT1", notify: true, location_id: "sloc_a", numbers: { ful_1: "OLD1", ful_2: " " } })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ url: "/admin/medusify/orders/o1/ship", method: "POST", body: { notify: true, location_id: "sloc_a", tracking_number: "AT1", tracking_url: "https://t.invalid/AT1", numbers: { ful_1: "OLD1" } } })
    // The call ends: iOS freezing the app must not hold the form busy for good.
    expect(inits[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it("sends no number when none was typed", async () => {
    stubRoute({ order_id: "o1", shipped: [], delivered: [], nothing_to_do: true })
    await shipOrder(home, order("o1"), { notify: false })
    expect(calls[0]!.body).toEqual({ notify: false })
  })

  it("a refusal of the route is the answer; it does not try the old way on top", async () => {
    stubRoute(400)
    await expect(shipOrder(home, order("o1"), { tracking_number: "T", notify: false })).rejects.toMatchObject({ kind: "rejected", status: 400 })
    expect(calls).toHaveLength(1)
  })

  it("a server error is the answer too (the outcome is open, the route may have shipped)", async () => {
    stubRoute(504)
    await expect(shipOrder(home, order("o1"), { tracking_number: "T", notify: false })).rejects.toBeInstanceOf(ApiError)
    expect(calls).toHaveLength(1)
  })

  it("the old way keeps a carrier's label and adds the typed number", async () => {
    calls.length = 0
    const packed = { order: { ...order("o1"), items: [{ id: "li_1", quantity: 1, detail: { fulfilled_quantity: 1, shipped_quantity: 0 } }], shipping_methods: [], fulfillments: [{ id: "ful_1", items: [{ line_item_id: "li_1", quantity: 1 }], labels: [{ tracking_number: "900000000017", tracking_url: "https://gls.invalid/x", label_url: "/api/v1/pdf" }] }] } }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://a", "")
        calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined })
        if (path.includes("/medusify/orders/o1/ship")) return new Response("Cannot POST", { status: 404 })
        if (path.startsWith("/admin/orders/o1?")) return new Response(JSON.stringify(packed), { status: 200 })
        return new Response("{}", { status: 200 })
      }),
    )
    await shipOrder(home, order("o1"), { tracking_number: "TYPED", notify: false })
    const shipment = calls.find((c) => c.url.endsWith("/shipments"))
    expect((shipment!.body as { labels: unknown }).labels).toEqual([
      { tracking_number: "900000000017", tracking_url: "https://gls.invalid/x", label_url: "" },
      { tracking_number: "TYPED", tracking_url: "", label_url: "" },
    ])
  })

  it("the old way counts an order with nothing left to ship as done (a repeat after a lost answer)", async () => {
    calls.length = 0
    const shipped = { order: { ...order("o1"), items: [{ id: "li_1", quantity: 1, detail: { fulfilled_quantity: 1, shipped_quantity: 1 } }], shipping_methods: [], fulfillments: [{ id: "ful_1", shipped_at: "2026-11-19T10:00:00Z" }] } }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://a", "")
        calls.push({ url: path, method: init.method ?? "GET" })
        if (path.includes("/medusify/orders/o1/ship")) return new Response("Cannot POST", { status: 404 })
        return new Response(JSON.stringify(shipped), { status: 200 })
      }),
    )
    // Done, and the typed number went nowhere: the form says so.
    await expect(shipOrder(home, order("o1"), { tracking_number: "T", notify: false })).resolves.toEqual({ unusedNumber: true })
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1)
  })
})

describe("labelsFor (same rule as the plugin)", () => {
  it("keeps the carrier's labels, blanks a relative label path, adds a new typed number once", () => {
    const existing = [{ tracking_number: "A", tracking_url: "javascript:x", label_url: "/pdf" }, { tracking_number: null }]
    expect(labelsFor(existing, { number: "B", url: "https://t.invalid/B" })).toEqual([
      { tracking_number: "A", tracking_url: "", label_url: "" },
      { tracking_number: "B", tracking_url: "https://t.invalid/B", label_url: "" },
    ])
    expect(labelsFor(existing, { number: "A" })).toHaveLength(1)
    expect(labelsFor(undefined, {})).toEqual([])
  })
})


describe("mainNumberTarget (same rule as the plugin)", () => {
  it("one candidate takes the number, several are ambiguous", async () => {
    const { mainNumberTarget } = await import("../src/lib/api")
    expect(mainNumberTarget(["a", "b"], new Set(["b"]), undefined)).toEqual({ target: "b", ambiguous: false })
    expect(mainNumberTarget(["a", "b"], new Set(), undefined)).toEqual({ ambiguous: true })
    expect(mainNumberTarget(["a", "b"], new Set(), { a: "x" })).toEqual({ target: "b", ambiguous: false })
  })
})

describe("the old way, review round 2", () => {
  function stubOrder(body: object) {
    calls.length = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://a", "")
        calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined })
        if (path.includes("/medusify/orders/o1/ship")) return new Response("Cannot POST", { status: 404 })
        if (path.startsWith("/admin/orders/o1?")) return new Response(JSON.stringify(body), { status: 200 })
        return new Response("{}", { status: 200 })
      }),
    )
  }
  const two = (labels0: object[]) => ({
    order: {
      ...order("o1"),
      shipping_methods: [],
      items: [
        { id: "li_1", quantity: 1, detail: { fulfilled_quantity: 1, shipped_quantity: 0 } },
        { id: "li_2", quantity: 1, detail: { fulfilled_quantity: 1, shipped_quantity: 0 } },
      ],
      fulfillments: [
        { id: "ful_1", items: [{ line_item_id: "li_1", quantity: 1 }], labels: labels0 },
        { id: "ful_2", items: [{ line_item_id: "li_2", quantity: 1 }], labels: [] },
      ],
    },
  })
  const labelsOf = () => calls.filter((c) => c.url.endsWith("/shipments")).map((c) => [c.url.split("/")[5], (c.body as { labels: { tracking_number: string; tracking_url: string }[] }).labels.map((l) => [l.tracking_number, l.tracking_url])])

  it("the link goes with the typed number only, not to packages with numbers of their own", async () => {
    stubOrder(two([]))
    await shipOrder(home, order("o1"), { notify: false, tracking_number: "MAIN", tracking_url: "https://t.invalid/MAIN", numbers: { ful_1: "OWN" } })
    expect(labelsOf()).toEqual([["ful_1", [["OWN", ""]]], ["ful_2", [["MAIN", "https://t.invalid/MAIN"]]]])
  })

  it("a number a package carries already stays there and goes on no second package", async () => {
    stubOrder(two([{ tracking_number: "FIRST", tracking_url: "" }]))
    const outcome = await shipOrder(home, order("o1"), { notify: false, tracking_number: "FIRST" })
    expect(labelsOf()).toEqual([["ful_1", [["FIRST", ""]]], ["ful_2", []]])
    expect(outcome).toEqual({ unusedNumber: false })
  })
})

describe("shipPlan", () => {
  it("a voucher left to fulfill makes no new parcel: the number belongs to the parcel waiting", async () => {
    const { shipPlan } = await import("../src/lib/api")
    stubShop({
      "/admin/orders/o1?": fullOrder({
        shipping_methods: [],
        items: [
          { id: "li_1", quantity: 1, requires_shipping: true, detail: { fulfilled_quantity: 1 } },
          { id: "li_v", quantity: 1, requires_shipping: false, detail: { fulfilled_quantity: 0 } },
        ],
        fulfillments: [{ id: "ful_1", location_id: "sloc_a", labels: [] }],
      }),
      "/admin/stock-locations": locations(["sloc_a", "A"]),
    })
    expect(await shipPlan(home, listEntry)).toMatchObject({ packsNew: false, packages: [{ id: "ful_1", labels: [] }] })
  })
})

