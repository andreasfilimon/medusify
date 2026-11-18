import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api"
import { makeT } from "../src/lib/i18n"
import { order, shop } from "./fixtures"

const shipOrder = vi.fn()
const fulfillmentLocations = vi.fn()
const invalidate = vi.fn()

vi.mock("../src/lib/api", async (orig) => ({ ...(await orig<typeof import("../src/lib/api")>()), shipOrder: (...a: unknown[]) => shipOrder(...a), fulfillmentLocations: (...a: unknown[]) => fulfillmentLocations(...a) }))
vi.mock("../src/lib/scan", () => ({ startScan: async () => ({ kind: "no-camera" }) }))
// The icons are inlined from ../docs/mocks at build time; the test does not need the pictures.
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), online: true }) }))

const { ShipForm } = await import("../src/ui/ShipForm")

function renderForm() {
  const qc = new QueryClient()
  const real = qc.invalidateQueries.bind(qc)
  qc.invalidateQueries = ((...a: Parameters<typeof qc.invalidateQueries>) => (invalidate(...a), real(...a))) as typeof qc.invalidateQueries
  return render(
    <QueryClientProvider client={qc}>
      <ShipForm shop={shop("a", { home: true })} order={order("o1")} onDone={() => {}} />
    </QueryClientProvider>,
  )
}

/** The locations arrive asynchronously; the user cannot tap faster than that, the test must not either. */
async function locationsLoaded() {
  await waitFor(() => expect(fulfillmentLocations).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
}

async function submit() {
  await locationsLoaded()
  fireEvent.change(screen.getByLabelText("Sendungsnummer"), { target: { value: "AT123456789" } })
  fireEvent.click(screen.getByRole("button", { name: "Als versendet markieren" }))
  await waitFor(() => expect(shipOrder).toHaveBeenCalled())
}

beforeEach(() => {
  shipOrder.mockReset()
  fulfillmentLocations.mockReset().mockResolvedValue([{ id: "sloc_1", name: "Wien" }])
  invalidate.mockReset()
})
afterEach(cleanup)

describe("ShipForm error text", () => {
  it("a network error does not claim that the shop rejected the shipment, and says what to do", async () => {
    shipOrder.mockRejectedValue(new ApiError("network"))
    renderForm()
    await submit()
    const text = (await screen.findByText(/Keine Antwort/)).textContent ?? ""
    expect(text).not.toMatch(/abgelehnt/)
    expect(text).toMatch(/neu laden/i)
    expect(text).toMatch(/nachsehen|prüfen/i)
  })
  it("a proxy timeout (502/504) leaves the outcome open just like a network error", async () => {
    shipOrder.mockRejectedValue(new ApiError("server", 504, "gateway timeout"))
    renderForm()
    await submit()
    expect((await screen.findByText(/Keine Antwort|offen/)).textContent).not.toMatch(/abgelehnt/)
  })
  it("after an open outcome the order and the lists are read again", async () => {
    shipOrder.mockRejectedValue(new ApiError("network"))
    renderForm()
    await submit()
    await screen.findByText(/Keine Antwort/)
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["order"] }))
  })
  it("a real rejection still says so and shows the shop's reason", async () => {
    shipOrder.mockRejectedValue(new ApiError("rejected", 400, "Items cannot be fulfilled"))
    renderForm()
    await submit()
    const text = (await screen.findByRole("alert")).textContent ?? ""
    expect(text).toMatch(/Nicht versendet/)
    expect(text).toMatch(/Items cannot be fulfilled/)
  })
  it("an expired login says so instead of blaming the shop", async () => {
    shipOrder.mockRejectedValue(new ApiError("unauthorized", 401))
    renderForm()
    await submit()
    const text = (await screen.findByRole("alert")).textContent ?? ""
    expect(text).toMatch(/Anmeldung/)
    expect(text).not.toMatch(/abgelehnt/)
  })
})

describe("ShipForm location", () => {
  it("one location: no question, but the location is sent", async () => {
    shipOrder.mockResolvedValue(undefined)
    renderForm()
    await screen.findByLabelText("Sendungsnummer")
    await submit()
    expect(screen.queryByLabelText("Versand ab Lager")).toBeNull()
    expect(shipOrder.mock.calls[0]![2]).toMatchObject({ location_id: "sloc_1" })
  })
  it("several locations: the user chooses and the choice is sent", async () => {
    fulfillmentLocations.mockResolvedValue([{ id: "sloc_a", name: "Graz" }, { id: "sloc_b", name: "Wien" }])
    shipOrder.mockResolvedValue(undefined)
    renderForm()
    const select = (await screen.findByLabelText("Versand ab Lager")) as HTMLSelectElement
    expect(select.value).toBe("sloc_a")
    fireEvent.change(select, { target: { value: "sloc_b" } })
    await submit()
    expect(shipOrder.mock.calls[0]![2]).toMatchObject({ location_id: "sloc_b" })
  })
  it("after a failure the location is read again: the fulfillment may exist now and fix the location", async () => {
    fulfillmentLocations
      .mockResolvedValueOnce([{ id: "sloc_a", name: "Graz" }, { id: "sloc_b", name: "Wien" }])
      .mockResolvedValue([{ id: "sloc_a", name: "Graz" }])
    shipOrder.mockRejectedValue(new ApiError("network"))
    renderForm()
    await screen.findByLabelText("Versand ab Lager")
    await submit()
    await screen.findByText(/Keine Antwort/)
    await waitFor(() => expect(screen.queryByLabelText("Versand ab Lager")).toBeNull())
    expect(fulfillmentLocations).toHaveBeenCalledTimes(2)
  })
})
