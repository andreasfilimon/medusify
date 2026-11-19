import { QueryClient, QueryClientProvider, onlineManager, useQuery } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ALL_ALLOWED } from "../src/lib/actions"
import { clearAttempts, gate } from "../src/lib/attempt"
import { toMinor } from "../src/lib/amount"
import { ApiError } from "../src/lib/api"
import { makeT } from "../src/lib/i18n"
import type { Order, OrderItem } from "../src/lib/types"
import { order, shop } from "./fixtures"

const api = {
  capturePayment: vi.fn(),
  markPaid: vi.fn(),
  cancelOrder: vi.fn(),
  markDelivered: vi.fn(),
  refundPayment: vi.fn(),
  acceptReturn: vi.fn(),
  getPermissions: vi.fn(),
}
vi.mock("../src/lib/api", async (orig) => {
  const real = await orig<typeof import("../src/lib/api")>()
  return { ...real, capturePayment: (...a: unknown[]) => api.capturePayment(...a), markPaid: (...a: unknown[]) => api.markPaid(...a), cancelOrder: (...a: unknown[]) => api.cancelOrder(...a), markDelivered: (...a: unknown[]) => api.markDelivered(...a), refundPayment: (...a: unknown[]) => api.refundPayment(...a), acceptReturn: (...a: unknown[]) => api.acceptReturn(...a), getPermissions: (...a: unknown[]) => api.getPermissions(...a) }
})
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
let online = true
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), lang: "de", online }) }))

const { OrderActions } = await import("../src/ui/OrderActions")

const item = (id: string, over: Partial<OrderItem> = {}): OrderItem =>
  ({ id, title: `Artikel ${id}`, product_title: `Artikel ${id}`, quantity: 2, total: 20, detail: { fulfilled_quantity: 2 }, ...over }) as OrderItem

const paid = (over: Partial<Order> = {}) =>
  order("o1", {
    display_id: 1001,
    total: 44.98,
    payment_collections: [{ id: "pc1", status: "completed", payments: [{ id: "pay1", amount: 44.98, captured_at: "2026-11-16T11:00:00Z", captures: [{ amount: 44.98 }], refunds: [] }] }],
    items: [item("i1"), item("i2", { total: 4.98, quantity: 1, detail: { fulfilled_quantity: 1 } })],
    ...over,
  })

const authorizedOrder = () =>
  order("o1", { display_id: 1001, payment_status: "authorized", payment_collections: [{ id: "pc1", status: "authorized", payments: [{ id: "pay1", amount: 44.98, captured_at: null }] }] })

// The order screen keeps an open query for its order; the sheets judge "read back" by it.
function OrderQuery({ o }: { o: Order }) {
  useQuery({ queryKey: ["order", "any", o.id], queryFn: async () => ({ shop: shop("a"), order: o }) })
  return null
}

function renderActions(o: Order, qc = new QueryClient(), probe = true) {
  return render(
    <QueryClientProvider client={qc}>
      {probe ? <OrderQuery o={o} /> : null}
      <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={o} />
    </QueryClientProvider>,
  )
}

const press = async (name: string | RegExp) => fireEvent.click(await screen.findByRole("button", { name }))

beforeEach(() => {
  online = true
  clearAttempts()
  Object.values(api).forEach((f) => f.mockReset())
  api.getPermissions.mockResolvedValue(ALL_ALLOWED)
  for (const k of ["capturePayment", "markPaid", "cancelOrder", "markDelivered", "refundPayment"] as const) api[k].mockResolvedValue(undefined)
  api.acceptReturn.mockResolvedValue({ return_id: "ret_1", refunded: true })
})
afterEach(cleanup)

describe("which actions the screen offers", () => {
  it("an authorized order offers capture and no refund", async () => {
    renderActions(authorizedOrder())
    expect(await screen.findByRole("button", { name: /Zahlung erfassen/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Erstatten/ })).toBeNull()
  })
  it("a captured order offers refund and cancel, not capture", async () => {
    renderActions(paid())
    expect(await screen.findByRole("button", { name: /Erstatten/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Bestellung stornieren/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Zahlung erfassen/ })).toBeNull()
  })
  it("hides what the role may not do, and shows nothing while the rights are unknown", async () => {
    api.getPermissions.mockResolvedValue({ ...ALL_ALLOWED, refund: false, cancel: false })
    renderActions(paid())
    await waitFor(() => expect(screen.getByRole("button", { name: /Retoure annehmen/ })).toBeTruthy())
    expect(screen.queryByRole("button", { name: /Erstatten/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Bestellung stornieren/ })).toBeNull()
  })
  it("a canceled order offers nothing to capture, cancel or return; money already captured can still go back", async () => {
    const { container } = renderActions(authorizedOrder().status === "canceled" ? authorizedOrder() : { ...authorizedOrder(), status: "canceled" })
    await waitFor(() => expect(api.getPermissions).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector("button")).toBeNull()
    cleanup()
    renderActions(paid({ status: "canceled" }))
    expect(await screen.findByRole("button", { name: /Erstatten/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Bestellung stornieren/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /Retoure annehmen/ })).toBeNull()
  })
  it("offline the actions are dead", async () => {
    online = false
    renderActions(paid())
    const row = await screen.findByRole("button", { name: /Erstatten/ })
    expect((row as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("capture, mark paid, cancel need a confirmation", () => {
  it("capture sends nothing before the confirm button and exactly one request after a double tap", async () => {
    let release!: () => void
    api.capturePayment.mockImplementation(() => new Promise<void>((r) => (release = r)))
    renderActions(authorizedOrder())
    await press(/Zahlung erfassen/)
    expect(api.capturePayment).not.toHaveBeenCalled()
    const confirm = await screen.findByRole("button", { name: /einziehen/ })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(api.capturePayment).toHaveBeenCalledTimes(1))
    expect(api.capturePayment).toHaveBeenCalledWith(expect.anything(), "pay1")
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    release()
  })
  it("cancel is a red button in a sheet that names the order and the shop", async () => {
    renderActions(paid())
    await press(/Bestellung stornieren/)
    expect(await screen.findByText(/#1001 bei Testshop/)).toBeTruthy()
    expect(api.cancelOrder).not.toHaveBeenCalled()
    const confirm = screen.getAllByRole("button", { name: "Bestellung stornieren" }).at(-1)!
    expect(confirm.className).toContain("danger")
    fireEvent.click(confirm)
    await waitFor(() => expect(api.cancelOrder).toHaveBeenCalledWith(expect.anything(), "o1"))
  })
  it("a lost answer says the outcome is open, not that the shop refused", async () => {
    api.capturePayment.mockRejectedValue(new ApiError("network"))
    renderActions(authorizedOrder())
    await press(/Zahlung erfassen/)
    fireEvent.click(await screen.findByRole("button", { name: /einziehen/ }))
    const text = (await screen.findByText(/Keine Antwort/)).textContent ?? ""
    expect(text).not.toMatch(/abgelehnt/)
  })
  it("a refusal shows the reason of the shop", async () => {
    api.markPaid.mockRejectedValue(new ApiError("rejected", 400, "Collection already paid"))
    renderActions(order("o1", { payment_status: "not_paid", payment_collections: [{ id: "pc9", status: "not_paid", payments: [] }] }))
    await press(/Als bezahlt markieren/)
    fireEvent.click(await screen.findByRole("button", { name: "Als bezahlt markieren" }))
    expect(await screen.findByText(/Collection already paid/)).toBeTruthy()
    expect(api.markPaid).toHaveBeenCalledWith(expect.anything(), "pc9", "o1")
  })
})

describe("two taps in the same frame", () => {
  // The button is disabled after the first tap, but only once React has rendered; the lock must hold before that.
  it("send one capture request", async () => {
    api.capturePayment.mockImplementation(() => new Promise(() => {}))
    renderActions(authorizedOrder())
    await press(/Zahlung erfassen/)
    const confirm = (await screen.findByRole("button", { name: /einziehen/ })) as HTMLButtonElement
    act(() => {
      confirm.click()
      confirm.click()
    })
    expect(api.capturePayment).toHaveBeenCalledTimes(1)
  })
  it("send one refund request", async () => {
    api.refundPayment.mockImplementation(() => new Promise(() => {}))
    renderActions(paid())
    await press(/Erstatten/)
    fireEvent.change(await screen.findByLabelText(/Betrag in EUR/), { target: { value: "5" } })
    await press("Weiter")
    const red = (await screen.findAllByRole("button", { name: /erstatten/ })).find((b) => b.className.includes("danger"))! as HTMLButtonElement
    act(() => {
      red.click()
      red.click()
    })
    expect(api.refundPayment).toHaveBeenCalledTimes(1)
  })
})

describe("refund", () => {
  const openRefund = async () => {
    renderActions(paid())
    await press(/Erstatten/)
    return await screen.findByLabelText(/Betrag in EUR/)
  }
  it("rejects an amount above the maximum before any request", async () => {
    const field = await openRefund()
    fireEvent.change(field, { target: { value: "44,99" } })
    fireEvent.blur(field)
    expect(await screen.findByText(/Höchstens .*44,98.* erstattbar/)).toBeTruthy()
    const next = screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.submit(field.closest("form")!)
    expect(screen.queryByText("Bestätigen")).toBeNull()
    expect(api.refundPayment).not.toHaveBeenCalled()
  })
  it("the sheet shows amount, currency and shop, and only the red button sends", async () => {
    const field = await openRefund()
    fireEvent.change(field, { target: { value: "12,50" } })
    await press("Weiter")
    expect(await screen.findByText("Bestätigen")).toBeTruthy()
    expect(screen.getByText("EUR")).toBeTruthy()
    expect(screen.getByText("Testshop")).toBeTruthy()
    expect(api.refundPayment).not.toHaveBeenCalled()
    const red = screen.getAllByRole("button", { name: /erstatten/ }).find((b) => b.className.includes("danger"))!
    expect(red.textContent).toMatch(/12,50/)
    fireEvent.click(red)
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(1))
    expect(api.refundPayment).toHaveBeenCalledWith(expect.anything(), "pay1", 12.5, expect.any(String))
  })
  it("a double tap on the red button sends one request, and a retry keeps the idempotency key", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(undefined)
    const field = await openRefund()
    fireEvent.change(field, { target: { value: "5" } })
    await press("Weiter")
    const red = (await screen.findAllByRole("button", { name: /erstatten/ })).find((b) => b.className.includes("danger"))!
    fireEvent.click(red)
    fireEvent.click(red)
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(1))
    await screen.findByText(/Keine Antwort/)
    fireEvent.click(red)
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(2))
    expect(api.refundPayment.mock.calls[1]![3]).toBe(api.refundPayment.mock.calls[0]![3])
  })
  it("'Alles' puts the maximum into the field", async () => {
    const field = (await openRefund()) as HTMLInputElement
    await press(/Alles/)
    expect(field.value).toBe("44,98")
  })
})

describe("return", () => {
  it("needs at least one item and sends the chosen quantities with the refund", async () => {
    renderActions(paid())
    await press(/Retoure annehmen/)
    const next = (await screen.findByRole("button", { name: "Weiter" })) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    const more = screen.getAllByRole("button", { name: "Mehr" })
    fireEvent.click(more[0]!)
    fireEvent.click(more[0]!)
    fireEvent.click(more[0]!)
    expect(screen.getAllByRole("group")[0]!.textContent).toContain("2")
    fireEvent.click(screen.getByRole("switch"))
    const field = screen.getByLabelText(/Betrag in EUR/) as HTMLInputElement
    expect(field.value).toBe("20,00")
    expect(next.disabled).toBe(false)
    fireEvent.click(next)
    const red = (await screen.findAllByRole("button", { name: /Eingang bestätigen/ })).find((b) => b.className.includes("danger"))!
    expect(red.textContent).toMatch(/20,00/)
    expect(api.acceptReturn).not.toHaveBeenCalled()
    fireEvent.click(red)
    fireEvent.click(red)
    await waitFor(() => expect(api.acceptReturn).toHaveBeenCalledTimes(1))
    expect(api.acceptReturn).toHaveBeenCalledWith(expect.anything(), { order_id: "o1", items: [{ id: "i1", quantity: 2 }], refund_amount: 20, idempotency_key: expect.any(String) })
  })
  it("refuses a refund above the refundable amount", async () => {
    renderActions(paid())
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[0]!)
    fireEvent.click(screen.getByRole("switch"))
    fireEvent.change(screen.getByLabelText(/Betrag in EUR/), { target: { value: "50" } })
    expect((screen.getByRole("button", { name: "Weiter" }) as HTMLButtonElement).disabled).toBe(true)
    expect(await screen.findByText(/Höchstens .*44,98/)).toBeTruthy()
  })
  it("a return without a refund is not red and sends no amount", async () => {
    renderActions(paid())
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[1]!)
    await press("Weiter")
    const go = (await screen.findAllByRole("button", { name: "Eingang bestätigen" })).at(-1)!
    expect(go.className).not.toContain("danger")
    fireEvent.click(go)
    await waitFor(() => expect(api.acceptReturn).toHaveBeenCalledWith(expect.anything(), { order_id: "o1", items: [{ id: "i2", quantity: 1 }], idempotency_key: expect.any(String) }))
  })
  it("a retry after a lost answer sends the same key; other items after going back get a new one", async () => {
    api.acceptReturn.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue({ return_id: "ret_1", refunded: false })
    renderActions(paid())
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[1]!)
    await press("Weiter")
    const go = () => screen.getAllByRole("button", { name: "Eingang bestätigen" }).at(-1)!
    fireEvent.click(go())
    await screen.findByText(/Keine Antwort/)
    await waitFor(() => expect((go() as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(go())
    await waitFor(() => expect(api.acceptReturn).toHaveBeenCalledTimes(2))
    const [first, second] = api.acceptReturn.mock.calls.map((c) => c[1].idempotency_key)
    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })
  it("a new attempt with other content has another key", async () => {
    api.acceptReturn.mockRejectedValueOnce(new ApiError("rejected", 400, "no")).mockResolvedValue({ return_id: "ret_1", refunded: false })
    renderActions(paid())
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[1]!)
    await press("Weiter")
    fireEvent.click(screen.getAllByRole("button", { name: "Eingang bestätigen" }).at(-1)!)
    await screen.findByText(/no/)
    await press("Zurück")
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[0]!)
    await press("Weiter")
    fireEvent.click(screen.getAllByRole("button", { name: "Eingang bestätigen" }).at(-1)!)
    await waitFor(() => expect(api.acceptReturn).toHaveBeenCalledTimes(2))
    const [first, second] = api.acceptReturn.mock.calls.map((c) => c[1].idempotency_key)
    expect(second).not.toBe(first)
  })
  it("after a lost answer the button stays locked until the order has been read again", async () => {
    api.acceptReturn.mockRejectedValue(new ApiError("network"))
    const qc = new QueryClient()
    const pending: (() => void)[] = []
    const reread = () => pending.forEach((r) => r())
    const real = qc.invalidateQueries.bind(qc)
    vi.spyOn(qc, "invalidateQueries").mockImplementation((...a) => new Promise<void>((r) => pending.push(() => void real(...a).then(() => r()))))
    renderActions(paid(), qc)
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[1]!)
    await press("Weiter")
    const go = () => screen.getAllByRole("button", { name: "Eingang bestätigen" }).at(-1)! as HTMLButtonElement
    fireEvent.click(go())
    await waitFor(() => expect(api.acceptReturn).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(pending.length).toBeGreaterThan(0))
    await new Promise((r) => setTimeout(r, 20))
    expect(go().disabled).toBe(true)
    fireEvent.click(go())
    expect(api.acceptReturn).toHaveBeenCalledTimes(1)
    await act(async () => reread())
    await screen.findByText(/Keine Antwort/)
    await waitFor(() => expect(go().disabled).toBe(false))
  })
})

describe("mark as delivered", () => {
  it("is one tap and asks the shop for the right fulfillment", async () => {
    renderActions(paid({ fulfillments: [{ id: "ful1", shipped_at: "2026-11-17T08:00:00Z", canceled_at: null, labels: [{ tracking_number: "T-9" }] }] }))
    await press(/Als zugestellt markieren/)
    await waitFor(() => expect(api.markDelivered).toHaveBeenCalledWith(expect.anything(), "o1", "ful1"))
  })
})

describe("mark as delivered shows at once", () => {
  const ful = { id: "ful1", shipped_at: "2026-11-17T08:00:00Z", canceled_at: null, delivered_at: null, labels: [] }
  const seeded = () => {
    const qc = new QueryClient()
    const o = paid({ fulfillments: [ful] })
    qc.setQueryData(["order", "any", "o1"], { shop: shop("a", { home: true }), order: o })
    return { qc, o }
  }
  const cached = (qc: QueryClient) => (qc.getQueryData(["order", "any", "o1"]) as { order: Order }).order.fulfillments?.[0]?.delivered_at

  it("the cached order says delivered before the shop has answered", async () => {
    let answer!: () => void
    api.markDelivered.mockReturnValue(new Promise<void>((r) => (answer = r)))
    const { qc, o } = seeded()
    renderActions(o, qc, false)
    await press(/Als zugestellt markieren/)
    await waitFor(() => expect(cached(qc)).toBeTruthy())
    answer()
  })
  it("a clear refusal takes it back and shows the reason", async () => {
    api.markDelivered.mockRejectedValue(new ApiError("rejected", 400, "no"))
    const { qc, o } = seeded()
    renderActions(o, qc, false)
    await press(/Als zugestellt markieren/)
    await screen.findByText(/no/)
    expect(cached(qc)).toBeNull()
  })
  it("a lost answer does not take it back (the shop may have done it)", async () => {
    api.markDelivered.mockRejectedValue(new TypeError("network"))
    const { qc, o } = seeded()
    renderActions(o, qc, false)
    await press(/Als zugestellt markieren/)
    await screen.findByText(/Keine Antwort/)
    expect(cached(qc)).toBeTruthy()
  })
})

describe("refund key", () => {
  it("going back to change the amount starts a new attempt with a new key", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("rejected", 400, "no")).mockResolvedValue(undefined)
    renderActions(paid())
    await press(/Erstatten/)
    const field = await screen.findByLabelText(/Betrag in EUR/)
    fireEvent.change(field, { target: { value: "5" } })
    await press("Weiter")
    fireEvent.click((await screen.findAllByRole("button", { name: /erstatten/ })).find((b) => b.className.includes("danger"))!)
    await screen.findByText(/no/)
    await press("Zurück")
    fireEvent.change(await screen.findByLabelText(/Betrag in EUR/), { target: { value: "6" } })
    await press("Weiter")
    fireEvent.click((await screen.findAllByRole("button", { name: /erstatten/ })).find((b) => b.className.includes("danger"))!)
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(2))
    expect(api.refundPayment.mock.calls[1]![3]).not.toBe(api.refundPayment.mock.calls[0]![3])
  })
})

describe("a lost answer never leads to a second refund or return", () => {
  const red = async () => (await screen.findAllByRole("button", { name: /erstatten|Eingang bestätigen/ })).filter((b) => b.className.includes("danger") || b.className.includes("primary")).at(-1)! as HTMLButtonElement
  const refundTo = async (amount: string) => {
    fireEvent.change(await screen.findByLabelText(/Betrag in EUR/), { target: { value: amount } })
    await press("Weiter")
  }
  const redRefund = async () => (await screen.findAllByRole("button", { name: /erstatten/ })).find((b) => b.className.includes("danger"))! as HTMLButtonElement

  it("refund: going back and sending the same amount again carries the same key", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(undefined)
    renderActions(paid())
    await press(/Erstatten/)
    await refundTo("5")
    fireEvent.click(await redRefund())
    await screen.findByText(/Keine Antwort/)
    await press("Zurück")
    await press("Weiter")
    fireEvent.click(await redRefund())
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(2))
    expect(api.refundPayment.mock.calls[1]![3]).toBe(api.refundPayment.mock.calls[0]![3])
  })

  it("refund: closing the sheet and opening it again keeps the key", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(undefined)
    renderActions(paid())
    await press(/Erstatten/)
    await refundTo("5")
    fireEvent.click(await redRefund())
    await screen.findByText(/Keine Antwort/)
    await press("Abbrechen")
    await press(/Erstatten/)
    await refundTo("5")
    fireEvent.click(await redRefund())
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(2))
    expect(api.refundPayment.mock.calls[1]![3]).toBe(api.refundPayment.mock.calls[0]![3])
  })

  it("refund: another amount after a lost answer is another refund and gets another key", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(undefined)
    renderActions(paid())
    await press(/Erstatten/)
    await refundTo("5")
    fireEvent.click(await redRefund())
    await screen.findByText(/Keine Antwort/)
    await press("Zurück")
    await refundTo("6")
    fireEvent.click(await redRefund())
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(2))
    expect(api.refundPayment.mock.calls[1]![3]).not.toBe(api.refundPayment.mock.calls[0]![3])
  })

  it("refund: while the order cannot be read back the red button stays dead, and it frees up with the reload", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(undefined)
    let readable = true
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const o = paid()
    function Probe() {
      useQuery({ queryKey: ["order", "any", "o1"], queryFn: async () => { if (!readable) throw new Error("offline"); return { shop: shop("a"), order: o } } })
      return null
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={o} />
      </QueryClientProvider>,
    )
    await press(/Erstatten/)
    await refundTo("5")
    readable = false
    fireEvent.click(await redRefund())
    await screen.findByText(/Keine Antwort/)
    await waitFor(async () => expect((await redRefund()).disabled).toBe(true))
    expect(screen.getByRole("button", { name: "Bestellung neu laden" })).toBeTruthy()
    readable = true
    fireEvent.click(screen.getByRole("button", { name: "Bestellung neu laden" }))
    await waitFor(async () => expect((await redRefund()).disabled).toBe(false))
    fireEvent.click(await redRefund())
    await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(2))
    expect(api.refundPayment.mock.calls[1]![3]).toBe(api.refundPayment.mock.calls[0]![3])
  })

  it("refund: the order is locked from the moment the answer is lost, not only after the refresh behind it has finished", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network"))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const o = paid()
    function Probe() {
      // The dashboard answers never, so the refresh that follows a lost answer stays open.
      useQuery({ queryKey: ["dashboard"], queryFn: () => new Promise<never>(() => {}) })
      return null
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={o} />
      </QueryClientProvider>,
    )
    await press(/Erstatten/)
    await refundTo("5")
    expect(gate("a|refund|o1|pay1", "a|o1", String(toMinor(44.98, "eur")))).toBe("open")
    fireEvent.click(await redRefund())
    await waitFor(() => expect(gate("a|refund|o1|pay1", "a|o1", String(toMinor(44.98, "eur")))).toBe("locked"))
    expect(qc.isFetching({ queryKey: ["dashboard"] })).toBe(1) // the refresh is still open
  })

  it("refund: leaving the order screen while the refresh runs is not a read-back, the lock stays", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network"))
    const qc = new QueryClient()
    const pending: (() => void)[] = []
    vi.spyOn(qc, "invalidateQueries").mockImplementation(() => new Promise<void>((r) => pending.push(r)))
    const o = paid()
    const tree = (withQuery: boolean) => (
      <QueryClientProvider client={qc}>
        {withQuery ? <OrderQuery o={o} /> : null}
        <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={o} />
      </QueryClientProvider>
    )
    const view = render(tree(true))
    await press(/Erstatten/)
    await refundTo("5")
    fireEvent.click(await redRefund())
    await waitFor(() => expect(pending.length).toBeGreaterThan(0))
    view.rerender(tree(false)) // the screen is left: no order query is open any more
    pending.forEach((r) => r())
    await screen.findByText(/Keine Antwort/)
    expect(gate("a|refund|o1|pay1", "a|o1", String(toMinor(44.98, "eur")))).toBe("locked")
  })

  it("refund: a phone that is offline has not read the order back, so the red button stays dead until the reload works", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(undefined)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const o = paid()
    function Probe() {
      useQuery({ queryKey: ["order", "any", "o1"], queryFn: async () => ({ shop: shop("a"), order: o }) })
      return null
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={o} />
      </QueryClientProvider>,
    )
    await press(/Erstatten/)
    await refundTo("5")
    await waitFor(() => expect(qc.getQueryState(["order", "any", "o1"])?.status).toBe("success"))
    onlineManager.setOnline(false)
    try {
      fireEvent.click(await redRefund())
      await screen.findByText(/Keine Antwort/)
      await waitFor(async () => expect((await redRefund()).disabled).toBe(true))
      expect(screen.getByRole("button", { name: "Bestellung neu laden" })).toBeTruthy()
      onlineManager.setOnline(true)
      fireEvent.click(screen.getByRole("button", { name: "Bestellung neu laden" }))
      await waitFor(async () => expect((await redRefund()).disabled).toBe(false))
      fireEvent.click(await redRefund())
      await waitFor(() => expect(api.refundPayment).toHaveBeenCalledTimes(2))
      expect(api.refundPayment.mock.calls[1]![3]).toBe(api.refundPayment.mock.calls[0]![3])
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it("a return whose answer was lost locks the refund sheet of the same order, which moves the same money", async () => {
    api.acceptReturn.mockRejectedValueOnce(new ApiError("network"))
    let readable = true
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const o = paid()
    function Probe() {
      useQuery({ queryKey: ["order", "any", "o1"], queryFn: async () => { if (!readable) throw new Error("offline"); return { shop: shop("a"), order: o } } })
      return null
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
        <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={o} />
      </QueryClientProvider>,
    )
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[1]!)
    await press("Weiter")
    readable = false
    fireEvent.click(await red())
    await screen.findByText(/Keine Antwort/)
    await press("Abbrechen")
    await press(/Erstatten/)
    await refundTo("5")
    expect((await redRefund()).disabled).toBe(true)
    expect(screen.getByRole("button", { name: "Bestellung neu laden" })).toBeTruthy()
    readable = true
    fireEvent.click(screen.getByRole("button", { name: "Bestellung neu laden" }))
    await waitFor(async () => expect((await redRefund()).disabled).toBe(false))
  })

  it("refund: when the read-back order shows the money gone, the sheet starts over instead of offering the same refund again", async () => {
    api.refundPayment.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue(undefined)
    const view = renderActions(paid())
    await press(/Erstatten/)
    await refundTo("5")
    fireEvent.click(await redRefund())
    await screen.findByText(/Keine Antwort/)
    const after = paid({
      payment_collections: [{ id: "pc1", status: "completed", payments: [{ id: "pay1", amount: 44.98, captured_at: "2026-11-16T11:00:00Z", captures: [{ amount: 44.98 }], refunds: [{ amount: 5 }] }] }],
    })
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        {null}
        <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={after} />
      </QueryClientProvider>,
    )
    expect(await screen.findByLabelText(/Betrag in EUR/)).toBeTruthy()
    expect(screen.getByText(/Bestellung hat sich seitdem geändert/)).toBeTruthy()
    expect(api.refundPayment).toHaveBeenCalledTimes(1)
  })

  it("return: going back and sending the same items again carries the same key", async () => {
    api.acceptReturn.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue({ return_id: "ret_1", refunded: false })
    renderActions(paid())
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[1]!)
    await press("Weiter")
    fireEvent.click(await red())
    await screen.findByText(/Keine Antwort/)
    await press("Zurück")
    await press("Weiter")
    fireEvent.click(await red())
    await waitFor(() => expect(api.acceptReturn).toHaveBeenCalledTimes(2))
    const [first, second] = api.acceptReturn.mock.calls.map((c) => c[1].idempotency_key)
    expect(first).toBeTruthy()
    expect(second).toBe(first)
  })

  it("return: when the read-back order shows the items gone, the sheet starts over", async () => {
    api.acceptReturn.mockRejectedValueOnce(new ApiError("network")).mockResolvedValue({ return_id: "ret_1", refunded: false })
    const view = renderActions(paid())
    await press(/Retoure annehmen/)
    fireEvent.click((await screen.findAllByRole("button", { name: "Mehr" }))[1]!)
    await press("Weiter")
    fireEvent.click(await red())
    await screen.findByText(/Keine Antwort/)
    const after = paid({ items: [item("i1"), item("i2", { total: 4.98, quantity: 1, detail: { fulfilled_quantity: 1, return_requested_quantity: 1 } })] })
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        {null}
        <OrderActions shop={shop("a", { home: true, name: "Testshop" })} order={after} />
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/Bestellung hat sich seitdem geändert/)).toBeTruthy()
    expect(api.acceptReturn).toHaveBeenCalledTimes(1)
  })
})
