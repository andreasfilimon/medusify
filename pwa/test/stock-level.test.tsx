import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api"
import { makeT } from "../src/lib/i18n"
import { shop } from "./fixtures"

const changeStock = vi.fn()
vi.mock("../src/lib/api", async (orig) => ({ ...(await orig<typeof import("../src/lib/api")>()), changeStock: (...a: unknown[]) => changeStock(...a) }))
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
const toast = vi.fn()
vi.mock("../src/ui/Toast", () => ({ useToast: () => ({ show: toast }) }))
vi.mock("../src/ui/Sheet", () => ({ Sheet: ({ children, title }: { children: unknown; title: string }) => <div role="dialog" aria-label={title}>{children as never}</div>, SheetAction: ({ label, form }: { label: string; form: string }) => <button type="submit" form={form}>{label}</button> }))
let online = true
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), online }) }))

const { StockLevel } = await import("../src/ui/StockLevel")

const level = { location_id: "loc_1", location_name: "Lager Wien", stocked: 10, reserved: 2, available: 8, incoming: 0 }
const mount = (over: Partial<typeof level> = {}, canEdit = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StockLevel shop={shop("a", { home: true })} inventoryItemId="inv_1" level={{ ...level, ...over }} canEdit={canEdit} label="Bestand Lager Wien" />
    </QueryClientProvider>,
  )
const answer = (stocked: number, delta: number) => ({ inventory_item_id: "inv_1", location_id: "loc_1", stocked, reserved: 2, available: stocked - 2, replayed: false, delta })

beforeEach(() => {
  changeStock.mockReset()
  toast.mockReset()
  online = true
})
afterEach(cleanup)

describe("stock of one variant at one place", () => {
  it("shows the number and what is reserved, and offers no save until it changes", () => {
    mount()
    expect(screen.getByText("Lager Wien")).toBeTruthy()
    expect(screen.getByText("2 reserviert")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /speichern/ })).toBeNull()
  })
  it("books the difference as one change by that amount, not as a new total", async () => {
    changeStock.mockResolvedValue(answer(12, 2))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "+2 speichern" }))
    await waitFor(() => expect(changeStock).toHaveBeenCalledTimes(1))
    expect(changeStock.mock.calls[0]![1]).toMatchObject({ mode: "adjust", inventory_item_id: "inv_1", location_id: "loc_1", quantity: 2 })
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Bestand gespeichert"))
  })
  it("takes the same key again after a lost answer, and a new one for another amount", async () => {
    changeStock.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(answer(11, 1))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "+1 speichern" }))
    await screen.findByText(/nicht doppelt/)
    fireEvent.click(screen.getByRole("button", { name: "+1 speichern" }))
    await waitFor(() => expect(changeStock).toHaveBeenCalledTimes(2))
    expect(changeStock.mock.calls[1]![1].idempotency_key).toBe(changeStock.mock.calls[0]![1].idempotency_key)
  })
  it("a second tap while the first is on its way sends nothing more", async () => {
    let finish!: (v: unknown) => void
    changeStock.mockReturnValue(new Promise((r) => (finish = r)))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    const save = screen.getByRole("button", { name: "+1 speichern" })
    fireEvent.click(save)
    fireEvent.click(save)
    fireEvent.click(save)
    expect(changeStock).toHaveBeenCalledTimes(1)
    finish(answer(11, 1))
    await waitFor(() => expect(toast).toHaveBeenCalled())
  })
  it("a refusal shows its sentence and the next try gets a new key", async () => {
    changeStock.mockRejectedValueOnce(new ApiError("rejected", 400, "medusify:below_zero")).mockResolvedValue(answer(9, -1))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Eins weniger" }))
    fireEvent.click(screen.getByRole("button", { name: "−1 speichern" }))
    await screen.findByText(/unter 0/)
    fireEvent.click(screen.getByRole("button", { name: "−1 speichern" }))
    await waitFor(() => expect(changeStock).toHaveBeenCalledTimes(2))
    expect(changeStock.mock.calls[1]![1].idempotency_key).not.toBe(changeStock.mock.calls[0]![1].idempotency_key)
  })
  it("discarding throws the draft away without a request", () => {
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }))
    expect(screen.queryByRole("button", { name: /speichern/ })).toBeNull()
    expect(changeStock).not.toHaveBeenCalled()
  })
  it("after a lost answer, discarding forgets the key: the same change later is a new request, not a repeat", async () => {
    changeStock.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(answer(11, 1))
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "+1 speichern" }))
    await screen.findByText(/nicht doppelt/)
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }))
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "+1 speichern" }))
    await waitFor(() => expect(changeStock).toHaveBeenCalledTimes(2))
    expect(changeStock.mock.calls[1]![1].idempotency_key).not.toBe(changeStock.mock.calls[0]![1].idempotency_key)
  })
  it("the same amount from another starting number is a new change (the first one was booked after all)", async () => {
    changeStock.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(answer(12, 1))
    const view = mount()
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "+1 speichern" }))
    await screen.findByText(/nicht doppelt/)
    // the refresh shows 11: the lost request was booked; a new "+1" from there must be booked too
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <StockLevel shop={shop("a", { home: true })} inventoryItemId="inv_1" level={{ ...level, stocked: 11 }} canEdit label="Bestand Lager Wien" />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Eins mehr" }))
    fireEvent.click(screen.getByRole("button", { name: "+1 speichern" }))
    await waitFor(() => expect(changeStock).toHaveBeenCalledTimes(2))
    expect(changeStock.mock.calls[1]![1].idempotency_key).not.toBe(changeStock.mock.calls[0]![1].idempotency_key)
  })
  it("without the right the number is plain text with no stepper", () => {
    mount({}, false)
    expect(screen.queryByRole("button", { name: "Eins mehr" })).toBeNull()
    expect(screen.getByText("10")).toBeTruthy()
  })
  it("a count typed in the sheet becomes the draft", async () => {
    mount()
    fireEvent.click(screen.getByRole("button", { name: "Bestand Lager Wien: 10, Zahl eingeben" }))
    const input = await screen.findByLabelText("Lager Wien")
    fireEvent.change(input, { target: { value: "25" } })
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }))
    expect(await screen.findByRole("button", { name: "+15 speichern" })).toBeTruthy()
  })
})
