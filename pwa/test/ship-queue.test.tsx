import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeT } from "../src/lib/i18n"
import { order, shop } from "./fixtures"

const home = shop("a", { home: true })

vi.mock("../src/lib/scan", () => ({ startScan: async () => ({ kind: "no-camera" }) }))
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), online: true, scoped: [home], shops: [home] }) }))

const { ShipQueue } = await import("../src/screens/ShipQueue")

type Call = { path: string; method: string; body?: any }
let calls: Call[] = []

/** What the order list returns: no shipping methods, no sales channel (LIST_FIELDS). */
const listed = { ...order("o1"), email: "buyer@example.invalid", items: [{ id: "li_1", quantity: 1, title: "Widget" }] }
const line = (fulfilled: number) => [{ id: "li_1", quantity: 1, detail: { fulfilled_quantity: fulfilled, shipped_quantity: 0 } }]

type Shape = { fulfillments?: unknown[]; fulfilled?: number }

/** A shop with two stock locations. The order's shipping option belongs to the one that sorts LAST by name. */
function stubShop(initial: Shape, afterFulfill?: Shape, optionGone = false) {
  calls = []
  let fulfilledNow = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace("https://a", "")
      const method = init.method ?? "GET"
      calls.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : undefined })
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
      // These cases test the old way (a plugin without the ship route); the route itself is tested in the plugin.
      if (method === "POST" && path.includes("/medusify/orders/o1/ship")) return new Response("Cannot POST", { status: 404 })
      if (method === "POST" && path.endsWith("/fulfillments")) {
        fulfilledNow = true
        return ok({})
      }
      if (method === "POST") return ok({})
      if (path.startsWith("/admin/orders?")) return ok({ orders: [listed], count: 1 })
      if (path.startsWith("/admin/orders/o1?")) {
        const s = fulfilledNow && afterFulfill ? afterFulfill : initial
        return ok({
          order: { ...order("o1"), sales_channel_id: "sc_1", shipping_methods: [{ shipping_option_id: "so_1" }], items: line(s.fulfilled ?? 0), fulfillments: s.fulfillments ?? [] },
        })
      }
      if (path.startsWith("/admin/shipping-options/so_1") && optionGone) return new Response("{}", { status: 404 })
      if (path.startsWith("/admin/shipping-options/so_1")) return ok({ shipping_option: { id: "so_1", service_zone: { fulfillment_set: { location: { id: "sloc_wien", name: "Wien" } } } } })
      if (path.startsWith("/admin/stock-locations")) return ok({ stock_locations: [{ id: "sloc_graz", name: "Graz" }, { id: "sloc_wien", name: "Wien" }] })
      return new Response(JSON.stringify({ message: `no route ${path}` }), { status: 500 })
    }),
  )
}

function renderQueue() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShipQueue />
    </QueryClientProvider>,
  )
}

/** The form with its location query settled: the user cannot tap faster than the shop answers. */
async function formReady() {
  const tracking = await screen.findByLabelText("Sendungsnummer (optional)")
  // The form reads the order itself for the location choice, then the option or the list.
  await waitFor(() => expect(calls.some((c) => c.path.startsWith("/admin/orders/o1?"))).toBe(true))
  await new Promise((r) => setTimeout(r, 100))
  return tracking
}

async function submit() {
  const tracking = await formReady()
  fireEvent.change(tracking, { target: { value: "AT123456789" } })
  fireEvent.click(screen.getByRole("button", { name: "Als versendet markieren" }))
}

const posts = () => calls.filter((c) => c.method === "POST")

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("ship queue with several stock locations", () => {
  it("books at the location of the order's shipping option, although the list has no shipping methods", async () => {
    stubShop({}, { fulfilled: 1, fulfillments: [{ id: "ful_1" }] })
    renderQueue()
    await submit()
    await waitFor(() => expect(posts().some((c) => c.path.endsWith("/fulfillments"))).toBe(true))
    expect(posts().find((c) => c.path.endsWith("/fulfillments"))?.body.location_id).toBe("sloc_wien")
  })

  it("shows no location choice when the shipping option fixes the location", async () => {
    stubShop({})
    renderQueue()
    await formReady()
    expect(calls.some((c) => c.path.startsWith("/admin/shipping-options"))).toBe(true)
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("a retry after a partial failure (fulfillment exists, nothing left to fulfill) offers no location choice and creates no second fulfillment", async () => {
    const existing = { id: "ful_1", location_id: "sloc_graz", shipped_at: null, canceled_at: null }
    // The shipping option is gone: without the fixed location of the fulfillment the form would list both locations.
    stubShop({ fulfilled: 1, fulfillments: [existing] }, undefined, true)
    renderQueue()
    const tracking = await formReady()
    // The form must not offer a choice that has no effect: the shipment goes with the existing fulfillment.
    expect(screen.queryByRole("combobox")).toBeNull()
    fireEvent.change(tracking, { target: { value: "AT123456789" } })
    fireEvent.click(screen.getByRole("button", { name: "Als versendet markieren" }))
    await waitFor(() => expect(posts().some((c) => c.path.endsWith("/shipments"))).toBe(true))
    expect(posts().some((c) => c.path.endsWith("/fulfillments"))).toBe(false)
  })
})

describe("ship queue paging and skipping", () => {
  /** 50 open but unpaid orders on the first page (the feed counts them as open rows, the queue skips them), one to ship on the second. */
  function stubPages(secondFails = false) {
    calls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const path = url.replace("https://a", "")
        calls.push({ path, method: init.method ?? "GET" })
        const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
        if (path.startsWith("/admin/orders?")) {
          const offset = Number(new URLSearchParams(path.split("?")[1]).get("offset"))
          if (offset === 0) return ok({ orders: Array.from({ length: 50 }, (_, n) => ({ ...order(`s${n}`), payment_status: "not_paid", items: [] })), count: 51 })
          if (secondFails) return new Response(JSON.stringify({ message: "down" }), { status: 503 })
          return ok({ orders: [{ ...listed, display_id: 77 }], count: 51 })
        }
        if (path.startsWith("/admin/orders/o1?")) return ok({ order: { ...order("o1"), items: line(0), fulfillments: [], shipping_methods: [] } })
        if (path.startsWith("/admin/stock-locations")) return ok({ stock_locations: [{ id: "sloc_wien", name: "Wien" }] })
        return new Response(JSON.stringify({ message: "x" }), { status: 500 })
      }),
    )
  }

  it("loads the next page when the first holds nothing to ship", async () => {
    // Before, the queue said "Alles versendet." with paid orders still waiting on the next page.
    stubPages()
    renderQueue()
    expect(await screen.findByText(/#77/)).toBeTruthy()
    expect(calls.filter((c) => c.path.startsWith("/admin/orders?")).length).toBe(2)
  })

  it("after skipping, the end says the skipped orders stay open", async () => {
    stubPages()
    renderQueue()
    await screen.findByText(/#77/)
    fireEvent.click(screen.getByRole("button", { name: "Überspringen" }))
    expect(await screen.findByText(/1 übersprungen, die bleiben offen/)).toBeTruthy()
  })

  it("a failed next page says so instead of \"all shipped\", and does not ask again in a loop", async () => {
    stubPages(true)
    renderQueue()
    expect((await screen.findByRole("alert")).textContent).toMatch(/konnten nicht geladen werden/)
    expect(screen.queryByText(/Alles versendet|Warteschlange leer/)).toBeNull()
    await new Promise((r) => setTimeout(r, 300))
    expect(calls.filter((c) => c.path.startsWith("/admin/orders?")).length).toBe(2)
  })
})
