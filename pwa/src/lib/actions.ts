import { fromMinor, toMinor } from "./amount"
import type { Order, Payment } from "./types"

/** The actions the app can do on an order. The keys are the ones the plugin's permissions route answers with. */
export const ACTION_KEYS = ["capture", "mark_paid", "cancel", "cancel_refunding", "deliver", "refund", "return", "ship", "catalog", "variant_edit", "product_status", "stock", "stock_new_level", "product_create", "upload", "stock_read", "customers", "discounts", "discount_create", "discount_edit", "manual_order", "order_edit", "exchange", "claim"] as const
export type ActionKey = (typeof ACTION_KEYS)[number]
export type Permissions = Record<ActionKey, boolean>

export const ALL_ALLOWED: Permissions = { capture: true, mark_paid: true, cancel: true, cancel_refunding: true, deliver: true, refund: true, return: true, ship: true, catalog: true, variant_edit: true, product_status: true, stock: true, stock_new_level: true, product_create: true, upload: true, stock_read: true, customers: true, discounts: true, discount_create: true, discount_edit: true, manual_order: true, order_edit: true, exchange: true, claim: true }

/** The order statuses in which Medusa lets an order be canceled (a completed order has to go through a return). */
const CANCELABLE = new Set(["pending", "requires_action"])

export type ReturnableItem = { id: string; title: string; variant: string | null; max: number; unit: number }

export type OrderActions = {
  /** Authorized but not captured: take the money. */
  capture: { paymentId: string; amount: number } | null
  /** Nothing paid and nothing authorized: the merchant got the money some other way. */
  markPaid: { collectionId: string } | null
  cancel: boolean
  /** One entry per shipment that is on its way and not marked as delivered. */
  deliver: { fulfillmentId: string; tracking: string | null }[]
  /** Captured and not yet refunded: the most that can still go back. */
  refund: { paymentId: string; max: number } | null
  /** Lines with units that can come back. */
  returnable: ReturnableItem[]
}

const sum = (rows: { amount?: number }[] | null | undefined, currency: string) => (rows ?? []).reduce((total, r) => total + toMinor(r.amount ?? 0, currency), 0)

/** What is left to refund of one payment: captured minus refunded, in whole minor units. */
export function refundableMinor(payment: Payment, currency: string): number {
  if (!payment.captured_at) return 0
  return Math.max(0, sum(payment.captures, currency) - sum(payment.refunds, currency))
}

const num = (n: number | undefined) => Number(n ?? 0)

/** Units of a line that were shipped out and are neither on a return nor back already. */
export function returnableQuantity(item: Order["items"] extends (infer I)[] | undefined ? I : never): number {
  const d = item.detail
  return Math.max(0, num(d?.fulfilled_quantity) - num(d?.return_requested_quantity) - num(d?.return_received_quantity) - num(d?.return_dismissed_quantity))
}

/**
 * What the user may do with this order right now. The order's own state decides what Medusa would accept (rules read
 * from core-flows 2.22.7: cancel needs every fulfillment canceled, mark-as-paid needs a "not_paid" collection, refund is
 * capped at captured minus refunded, a return takes only fulfilled units); `allowed` removes what the user's role may
 * not do, so no button leads to an error.
 */
export function orderActions(order: Order, allowed: Permissions = ALL_ALLOWED): OrderActions {
  const none: OrderActions = { capture: null, markPaid: null, cancel: false, deliver: [], refund: null, returnable: [] }
  const canceled = order.status === "canceled"
  const collections = order.payment_collections ?? []
  const payments = collections.flatMap((c) => c.payments ?? [])
  const currency = order.currency_code

  const toCapture = !canceled && order.payment_status === "authorized" ? payments.find((p) => !p.captured_at && !p.canceled_at) : undefined
  const unpaid = !canceled ? collections.find((c) => c.status === "not_paid") : undefined
  const refundable = payments.map((p) => ({ p, minor: refundableMinor(p, currency) })).find((x) => x.minor > 0)
  // Medusa refunds captured money when it cancels, so such an order needs the refund right as well.
  const mayCancel = allowed.cancel && (!refundable || allowed.cancel_refunding)
  const fulfillments = order.fulfillments ?? []

  return {
    ...none,
    capture: allowed.capture && toCapture ? { paymentId: toCapture.id, amount: toCapture.amount ?? 0 } : null,
    markPaid: allowed.mark_paid && unpaid ? { collectionId: unpaid.id } : null,
    cancel: mayCancel && CANCELABLE.has(order.status) && fulfillments.every((f) => !!f.canceled_at),
    deliver: allowed.deliver && !canceled
      ? fulfillments
          .filter((f) => f.shipped_at && !f.canceled_at && !f.delivered_at)
          .map((f) => ({ fulfillmentId: f.id, tracking: f.labels?.find((l) => l.tracking_number)?.tracking_number ?? null }))
      : [],
    refund: allowed.refund && refundable ? { paymentId: refundable.p.id, max: fromMinor(refundable.minor, currency) } : null,
    returnable: allowed.return && !canceled
      ? (order.items ?? [])
          .map((i) => ({
            id: i.id,
            title: i.product_title || i.title,
            variant: i.variant_title ?? null,
            max: returnableQuantity(i),
            unit: i.quantity > 0 ? fromMinor(Math.round(toMinor(i.total, currency) / i.quantity), currency) : 0,
          }))
          .filter((i) => i.max > 0)
      : [],
  }
}

/** The refund that goes with a return: what the chosen units cost, never more than can still be refunded. */
export function suggestedRefund(items: ReturnableItem[], chosen: Record<string, number>, currency: string, max: number): number {
  const minor = items.reduce((total, i) => total + toMinor(i.unit, currency) * Math.min(chosen[i.id] ?? 0, i.max), 0)
  return fromMinor(Math.min(minor, toMinor(max, currency)), currency)
}

/** `tel:` and `mailto:` addresses for the order's customer; each only when the order has the data. */
export function contactLinks(order: Pick<Order, "email" | "shipping_address">): { email: { text: string; href: string } | null; phone: { text: string; href: string } | null } {
  const email = order.email?.trim()
  const phone = order.shipping_address?.phone?.trim()
  // A tel: address carries digits, an optional leading plus and nothing else; spaces and punctuation from the form go.
  const dial = phone ? (phone.startsWith("+") ? "+" : "") + phone.replace(/\D/g, "") : ""
  return {
    email: email ? { text: email, href: `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}` } : null,
    phone: dial.replace("+", "") ? { text: phone!, href: `tel:${dial}` } : null,
  }
}
