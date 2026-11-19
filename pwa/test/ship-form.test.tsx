import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api"
import { makeT } from "../src/lib/i18n"
import { order, shop } from "./fixtures"

const shipOrder = vi.fn()
const shipPlan = vi.fn()
const getPermissions = vi.fn()
const invalidate = vi.fn()

vi.mock("../src/lib/api", async (orig) => ({ ...(await orig<typeof import("../src/lib/api")>()), shipOrder: (...a: unknown[]) => shipOrder(...a), shipPlan: (...a: unknown[]) => shipPlan(...a), getPermissions: (...a: unknown[]) => getPermissions(...a) }))
vi.mock("../src/lib/scan", () => ({ startScan: async () => ({ kind: "no-camera" }) }))
// The icons are inlined from ../docs/mocks at build time; the test does not need the pictures.
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
const toastShow = vi.fn()
vi.mock("../src/ui/Toast", async (orig) => ({ ...(await orig<typeof import("../src/ui/Toast")>()), useToast: () => ({ show: toastShow }) }))
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), online: true }) }))

const { ShipForm } = await import("../src/ui/ShipForm")

const plan = (locations: { id: string; name: string }[], more: Partial<{ packsNew: boolean; packages: { id: string; labels: string[] }[] }> = {}) => ({ locations, packsNew: true, packages: [], ...more })
const onBusy = vi.fn()

function renderForm() {
  const qc = new QueryClient()
  const real = qc.invalidateQueries.bind(qc)
  qc.invalidateQueries = ((...a: Parameters<typeof qc.invalidateQueries>) => (invalidate(...a), real(...a))) as typeof qc.invalidateQueries
  return render(
    <QueryClientProvider client={qc}>
      <ShipForm shop={shop("a", { home: true })} order={order("o1")} onDone={() => {}} onBusyChange={onBusy} />
    </QueryClientProvider>,
  )
}

/** The locations arrive asynchronously; the user cannot tap faster than that, the test must not either. */
async function locationsLoaded() {
  await waitFor(() => expect(shipPlan).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 0))
}

async function submit(number = "AT123456789") {
  await locationsLoaded()
  if (number) fireEvent.change(screen.getByLabelText("Sendungsnummer (optional)"), { target: { value: number } })
  fireEvent.click(screen.getByRole("button", { name: "Als versendet markieren" }))
  await waitFor(() => expect(shipOrder).toHaveBeenCalled())
}

beforeEach(() => {
  shipOrder.mockReset()
  shipPlan.mockReset().mockResolvedValue(plan([{ id: "sloc_1", name: "Wien" }]))
  getPermissions.mockReset().mockResolvedValue({ ship: true })
  invalidate.mockReset()
  onBusy.mockReset()
  toastShow.mockReset()
})
afterEach(cleanup)

describe("ShipForm error text", () => {
  it("a network error does not claim that the shop rejected the shipment, and says what to do", async () => {
    shipOrder.mockRejectedValue(new ApiError("network"))
    renderForm()
    await submit()
    const text = (await screen.findByText(/Keine Antwort/)).textContent ?? ""
    expect(text).not.toMatch(/abgelehnt/)
    // The ship route is idempotent: a second try finds the work done instead of shipping twice.
    expect(text).toMatch(/noch einmal versuchen ist sicher/i)
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
  it("after a rejection the order is read again too: part of the work may be done", async () => {
    shipOrder.mockRejectedValue(new ApiError("rejected", 400, "Items cannot be fulfilled"))
    renderForm()
    await submit()
    await screen.findByRole("alert")
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
    await screen.findByLabelText("Sendungsnummer (optional)")
    await submit()
    expect(screen.queryByLabelText("Versand ab Lager")).toBeNull()
    expect(shipOrder.mock.calls[0]![2]).toMatchObject({ location_id: "sloc_1" })
  })
  it("several locations: the user chooses and the choice is sent", async () => {
    shipPlan.mockResolvedValue(plan([{ id: "sloc_a", name: "Graz" }, { id: "sloc_b", name: "Wien" }]))
    shipOrder.mockResolvedValue(undefined)
    renderForm()
    const select = (await screen.findByLabelText("Versand ab Lager")) as HTMLSelectElement
    expect(select.value).toBe("sloc_a")
    fireEvent.change(select, { target: { value: "sloc_b" } })
    await submit()
    expect(shipOrder.mock.calls[0]![2]).toMatchObject({ location_id: "sloc_b" })
  })
  it("after a failure the location is read again: the fulfillment may exist now and fix the location", async () => {
    shipPlan
      .mockResolvedValueOnce(plan([{ id: "sloc_a", name: "Graz" }, { id: "sloc_b", name: "Wien" }]))
      .mockResolvedValue(plan([{ id: "sloc_a", name: "Graz" }]))
    shipOrder.mockRejectedValue(new ApiError("network"))
    renderForm()
    await screen.findByLabelText("Versand ab Lager")
    await submit()
    await screen.findByText(/Keine Antwort/)
    await waitFor(() => expect(screen.queryByLabelText("Versand ab Lager")).toBeNull())
    expect(shipPlan).toHaveBeenCalledTimes(2)
  })
})

describe("ShipForm packages and numbers", () => {
  it("ships without a number: a carrier integration may set its own", async () => {
    shipOrder.mockResolvedValue(undefined)
    renderForm()
    await submit("")
    expect(shipOrder.mock.calls[0]![2]).toMatchObject({ tracking_number: undefined })
  })
  it("shows the carrier's label of a package packed earlier and says it is kept", async () => {
    shipPlan.mockResolvedValue(plan([{ id: "sloc_1", name: "Wien" }], { packsNew: false, packages: [{ id: "ful_1", labels: ["900000000017"] }] }))
    renderForm()
    expect((await screen.findByText(/900000000017/)).textContent).toMatch(/bleibt erhalten/i)
    expect(screen.queryByText(/Ohne Nummer/)).toBeNull()
  })
  it("a package packed earlier without a number gets a field of its own, and its number is sent for it", async () => {
    shipPlan.mockResolvedValue(plan([{ id: "sloc_1", name: "Wien" }], { packsNew: true, packages: [{ id: "ful_1", labels: [] }] }))
    shipOrder.mockResolvedValue(undefined)
    renderForm()
    fireEvent.change(await screen.findByLabelText(/Paket 1/), { target: { value: "old 123" } })
    await submit("NEW456")
    expect(shipOrder.mock.calls[0]![2]).toMatchObject({ tracking_number: "NEW456", numbers: { ful_1: "old123" } })
  })
  it("the only package packed earlier takes the main number, no second field", async () => {
    shipPlan.mockResolvedValue(plan([{ id: "sloc_1", name: "Wien" }], { packsNew: false, packages: [{ id: "ful_1", labels: [] }] }))
    renderForm()
    await locationsLoaded()
    expect(screen.queryByLabelText(/Paket 1/)).toBeNull()
  })
  it("a role that may not ship sees why and cannot send", async () => {
    getPermissions.mockResolvedValue({ ship: false })
    renderForm()
    await screen.findByText(/darf nicht versenden/)
    expect((screen.getByRole("button", { name: "Als versendet markieren" }) as HTMLButtonElement).disabled).toBe(true)
  })
  it("tells the sheet while it is busy, so the sheet cannot be closed half way", async () => {
    let finish: () => void = () => {}
    shipOrder.mockReturnValue(new Promise<void>((r) => (finish = r)))
    renderForm()
    await submit()
    expect(onBusy).toHaveBeenLastCalledWith(true)
    finish()
    await waitFor(() => expect(onBusy).toHaveBeenLastCalledWith(false))
  })
})

describe("ShipForm with several packages waiting", () => {
  it("hides the single number field and sends one number per package", async () => {
    shipPlan.mockResolvedValue(plan([{ id: "sloc_1", name: "Wien" }], { packsNew: false, packages: [{ id: "ful_1", labels: [] }, { id: "ful_2", labels: [] }] }))
    shipOrder.mockResolvedValue(undefined)
    renderForm()
    fireEvent.change(await screen.findByLabelText(/Paket 1/), { target: { value: "N1" } })
    fireEvent.change(screen.getByLabelText(/Paket 2/), { target: { value: "N2" } })
    expect(screen.queryByLabelText("Sendungsnummer (optional)")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Als versendet markieren" }))
    await waitFor(() => expect(shipOrder).toHaveBeenCalled())
    expect(shipOrder.mock.calls[0]![2]).toMatchObject({ tracking_number: undefined, numbers: { ful_1: "N1", ful_2: "N2" } })
  })
  it("the shop's answer that one number fits several packages asks for a number per package", async () => {
    shipOrder.mockRejectedValue(new ApiError("rejected", 400, "medusify:numbers_required"))
    renderForm()
    await submit()
    expect((await screen.findByRole("alert")).textContent).toMatch(/für jedes Paket seine Nummer/)
  })
})

describe("ShipForm after a ship without effect for the number", () => {
  it("says that the number went on no package", async () => {
    shipOrder.mockResolvedValue({ unusedNumber: true })
    renderForm()
    await submit()
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(makeT("de")("ship.doneNumberUnused")))
  })

  it("says plainly done when the number found its package", async () => {
    shipOrder.mockResolvedValue({ unusedNumber: false })
    renderForm()
    await submit()
    await waitFor(() => expect(toastShow).toHaveBeenCalledWith(makeT("de")("ship.done")))
  })
})
