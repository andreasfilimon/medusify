import { describe, expect, it } from "vitest"
import { ALL_ALLOWED, contactLinks, orderActions, refundableMinor, returnableQuantity, suggestedRefund, type Permissions } from "../src/lib/actions"
import type { Order, OrderItem } from "../src/lib/types"
import { order } from "./fixtures"

const item = (id: string, over: Partial<OrderItem> = {}): OrderItem =>
  ({ id, title: `Item ${id}`, product_title: `Item ${id}`, quantity: 2, total: 20, detail: { fulfilled_quantity: 2 }, ...over }) as OrderItem

const authorized = (over: Partial<Order> = {}) =>
  order("1", {
    payment_status: "authorized",
    payment_collections: [{ id: "pc1", status: "authorized", payments: [{ id: "pay1", amount: 44.98, captured_at: null }] }],
    ...over,
  })

const captured = (refunds: number[] = [], over: Partial<Order> = {}) =>
  order("1", {
    payment_collections: [
      { id: "pc1", status: "completed", payments: [{ id: "pay1", amount: 44.98, captured_at: "2026-11-16T11:00:00Z", captures: [{ amount: 44.98 }], refunds: refunds.map((amount) => ({ amount })) }] },
    ],
    ...over,
  })

const none = (key: keyof Permissions): Permissions => ({ ...ALL_ALLOWED, [key]: false })

describe("capture", () => {
  it("is offered for an authorized payment", () => expect(orderActions(authorized()).capture).toEqual({ paymentId: "pay1", amount: 44.98 }))
  it("is not offered once captured", () => expect(orderActions(captured()).capture).toBeNull())
  it("is not offered for a canceled order", () => expect(orderActions(authorized({ status: "canceled" })).capture).toBeNull())
  it("is hidden without the right", () => expect(orderActions(authorized(), none("capture")).capture).toBeNull())
})

describe("mark as paid", () => {
  const unpaid = order("1", { payment_status: "not_paid", payment_collections: [{ id: "pc9", status: "not_paid", payments: [] }] })
  it("is offered for a collection that is not paid", () => expect(orderActions(unpaid).markPaid).toEqual({ collectionId: "pc9" }))
  it("is not offered when the money is authorized or in", () => {
    expect(orderActions(authorized()).markPaid).toBeNull()
    expect(orderActions(captured()).markPaid).toBeNull()
  })
  it("is hidden without the right", () => expect(orderActions(unpaid, none("mark_paid")).markPaid).toBeNull())
})

describe("cancel", () => {
  it("is offered for a pending order nothing shipped from", () => expect(orderActions(captured()).cancel).toBe(true))
  it("is not offered once a shipment is on its way", () => {
    const o = captured([], { fulfillments: [{ id: "f1", shipped_at: "2026-11-17T08:00:00Z", canceled_at: null }] })
    expect(orderActions(o).cancel).toBe(false)
  })
  it("is offered when every fulfillment is canceled", () => {
    const o = captured([], { fulfillments: [{ id: "f1", shipped_at: null, canceled_at: "2026-11-17T08:00:00Z" }] })
    expect(orderActions(o).cancel).toBe(true)
  })
  it("is not offered for completed or canceled orders", () => {
    expect(orderActions(captured([], { status: "completed" })).cancel).toBe(false)
    expect(orderActions(captured([], { status: "canceled" })).cancel).toBe(false)
  })
  it("is hidden without the right", () => expect(orderActions(captured(), none("cancel")).cancel).toBe(false))
  // Medusa refunds what was captured when it cancels: the user needs the refund right for that, as for a plain refund.
  it("with captured money that can still be refunded needs the refund right as well", () => {
    expect(orderActions(captured(), none("cancel_refunding")).cancel).toBe(false)
    expect(orderActions(captured([10]), none("cancel_refunding")).cancel).toBe(false)
  })
  it("needs only the cancel right when no captured money is left to give back", () => {
    expect(orderActions(captured([44.98]), none("cancel_refunding")).cancel).toBe(true)
    expect(orderActions(authorized(), none("cancel_refunding")).cancel).toBe(true)
  })
})

describe("mark as delivered", () => {
  const shipped = (delivered: string | null = null) =>
    captured([], { fulfillments: [{ id: "f1", shipped_at: "2026-11-17T08:00:00Z", canceled_at: null, delivered_at: delivered, labels: [{ tracking_number: "T-1" }] }] })
  it("is offered for a shipment on its way, with the tracking number", () => expect(orderActions(shipped()).deliver).toEqual([{ fulfillmentId: "f1", tracking: "T-1" }]))
  it("is not offered once delivered", () => expect(orderActions(shipped("2026-11-18T08:00:00Z")).deliver).toEqual([]))
  it("is not offered for a shipment that was never shipped", () => {
    expect(orderActions(captured([], { fulfillments: [{ id: "f2", shipped_at: null, canceled_at: null }] })).deliver).toEqual([])
  })
  it("is hidden without the right", () => expect(orderActions(shipped(), none("deliver")).deliver).toEqual([]))
})

describe("refund", () => {
  it("offers the whole captured amount", () => expect(orderActions(captured()).refund).toEqual({ paymentId: "pay1", max: 44.98 }))
  it("offers only what is left after a partial refund", () => expect(orderActions(captured([10, 4.98])).refund).toEqual({ paymentId: "pay1", max: 30 }))
  it("is not offered once everything is refunded", () => expect(orderActions(captured([44.98])).refund).toBeNull())
  it("is not offered for money that was never captured", () => expect(orderActions(authorized()).refund).toBeNull())
  it("is hidden without the right", () => expect(orderActions(captured(), none("refund")).refund).toBeNull())
  it("counts in whole cents", () => {
    const p = { id: "p", captured_at: "x", captures: [{ amount: 0.3 }], refunds: [{ amount: 0.1 }, { amount: 0.2 }] }
    expect(refundableMinor(p, "eur")).toBe(0)
  })
})

describe("return", () => {
  const shippedOrder = (items: OrderItem[]) => captured([], { items })
  it("offers shipped units that are not on a return", () => {
    const a = orderActions(shippedOrder([item("a"), item("b", { detail: { fulfilled_quantity: 2, return_requested_quantity: 2 } }), item("c", { detail: { fulfilled_quantity: 0 } })]))
    expect(a.returnable.map((i) => [i.id, i.max])).toEqual([["a", 2]])
  })
  it("subtracts units already received or dismissed", () => {
    expect(returnableQuantity(item("a", { detail: { fulfilled_quantity: 3, return_received_quantity: 1, return_dismissed_quantity: 1 } }))).toBe(1)
  })
  it("never goes below zero", () => expect(returnableQuantity(item("a", { detail: { fulfilled_quantity: 1, return_requested_quantity: 3 } }))).toBe(0))
  it("carries the unit price in whole cents", () => expect(orderActions(shippedOrder([item("a", { quantity: 3, total: 10 })])).returnable[0]!.unit).toBe(3.33))
  it("is not offered for a canceled order or without the right", () => {
    expect(orderActions(captured([], { status: "canceled", items: [item("a")] })).returnable).toEqual([])
    expect(orderActions(shippedOrder([item("a")]), none("return")).returnable).toEqual([])
  })
})

describe("refund that goes with a return", () => {
  const items = [
    { id: "a", title: "A", variant: null, max: 2, unit: 10 },
    { id: "b", title: "B", variant: null, max: 1, unit: 5.5 },
  ]
  it("adds up the chosen units", () => expect(suggestedRefund(items, { a: 2, b: 1 }, "eur", 100)).toBe(25.5))
  it("never exceeds what can still be refunded", () => expect(suggestedRefund(items, { a: 2, b: 1 }, "eur", 12)).toBe(12))
  it("does not count more units than exist", () => expect(suggestedRefund(items, { a: 9 }, "eur", 100)).toBe(20))
  it("is zero with nothing chosen", () => expect(suggestedRefund(items, {}, "eur", 100)).toBe(0))
})

describe("contact links", () => {
  it("builds mailto and tel", () => {
    const l = contactLinks({ email: "kunde@example.invalid", shipping_address: { phone: "+43 660 123 45 67" } })
    expect(l.email).toEqual({ text: "kunde@example.invalid", href: "mailto:kunde@example.invalid" })
    expect(l.phone).toEqual({ text: "+43 660 123 45 67", href: "tel:+436601234567" })
  })
  it("leaves out what the order does not have", () => {
    expect(contactLinks({ email: null, shipping_address: null })).toEqual({ email: null, phone: null })
    expect(contactLinks({ email: " ", shipping_address: { phone: "  " } })).toEqual({ email: null, phone: null })
  })
  it("drops characters that do not belong in a number and cannot smuggle a second target", () => {
    expect(contactLinks({ email: null, shipping_address: { phone: "(0660) 12-34;ext=1" } }).phone?.href).toBe("tel:066012341")
  })
  it("encodes an address that carries a query", () => {
    expect(contactLinks({ email: "a@example.invalid?cc=x@example.invalid", shipping_address: null }).email?.href).toBe("mailto:a@example.invalid%3Fcc%3Dx@example.invalid")
  })
})
