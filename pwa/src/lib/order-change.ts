import { returnableQuantity } from "./actions"
import { ApiError } from "./api"
import type { Order } from "./types"

export type ChangeKind = "edit" | "exchange" | "claim"
export type ClaimReason = "missing_item" | "wrong_item" | "production_failure" | "other"
export const CLAIM_REASONS: ClaimReason[] = ["production_failure", "wrong_item", "missing_item", "other"]

/** The body the plugin takes (POST /admin/medusify/orders/:id/change[/preview], plugin 0.4.0). */
export type ChangeBody =
  | { kind: "edit"; items: { id: string; quantity: number }[]; add: { variant_id: string; quantity: number }[]; note?: string | null }
  | { kind: "exchange"; return_items: { id: string; quantity: number }[]; add: { variant_id: string; quantity: number }[]; note?: string | null }
  | { kind: "claim"; type: "refund" | "replace"; items: { id: string; quantity: number; reason: ClaimReason }[]; add: { variant_id: string; quantity: number }[]; note?: string | null }

/**
 * What the change does to the money: open to pay `difference` more (+) or to give back (−) once confirmed.
 * `goods_value` is what the lines coming back (exchange) or claimed are worth: Medusa counts an exchange's goods when the
 * return is received, and a claim moves no money by itself.
 */
export type ChangeMoney = { currency_code: string; total_before: number; total_after: number; difference: number; goods_value: number }

/** One line of the order as the form offers it: `start` is the stepper's value before any change. */
export type ChangeLine = { id: string; title: string; variant: string | null; start: number; min: number; max: number | undefined }

const num = (n: number | undefined | null) => Number(n ?? 0)

/**
 * The lines the form offers, by the rule Medusa applies to each kind:
 * - edit: every line; not below what is already fulfilled;
 * - exchange: only units that were sent and are not on a return yet (Medusa takes back only what was fulfilled);
 * - claim: units that were sent (a claim is about goods the customer got).
 */
export function changeLines(order: Pick<Order, "items">, kind: ChangeKind): ChangeLine[] {
  return (order.items ?? [])
    .map((i) => {
      const title = i.product_title || i.title
      const variant = i.variant_title ?? null
      if (kind === "edit") return { id: i.id, title, variant, start: num(i.quantity), min: Math.min(num(i.quantity), num(i.detail?.fulfilled_quantity)), max: undefined }
      const max = kind === "exchange" ? returnableQuantity(i) : num(i.detail?.fulfilled_quantity)
      return { id: i.id, title, variant, start: 0, min: 0, max }
    })
    .filter((l) => kind === "edit" || (l.max ?? 0) > 0)
}

/** The request from the form, or null while it would change nothing (an exchange needs lines both ways). */
export function changeBody(
  kind: ChangeKind,
  lines: readonly ChangeLine[],
  wanted: Readonly<Record<string, number>>,
  add: readonly { variant_id: string; quantity: number }[],
  claim: { reason: ClaimReason; type: "refund" | "replace" },
  order: Pick<Order, "items">,
): ChangeBody | null {
  const out = add.filter((l) => l.quantity > 0).map((l) => ({ variant_id: l.variant_id, quantity: l.quantity }))
  if (kind === "edit") {
    const items = lines.filter((l) => wanted[l.id] !== undefined && wanted[l.id] !== l.start).map((l) => ({ id: l.id, quantity: Math.max(l.min, wanted[l.id]!) }))
    return items.length || out.length ? { kind, items, add: out } : null
  }
  const picked = lines.filter((l) => (wanted[l.id] ?? 0) > 0).map((l) => ({ id: l.id, quantity: Math.min(l.max ?? Infinity, wanted[l.id]!) }))
  if (kind === "exchange") return picked.length && out.length ? { kind, return_items: picked, add: out } : null
  if (!picked.length) return null
  return { kind, type: claim.type, items: picked.map((p) => ({ ...p, reason: claim.reason })), add: claim.type === "replace" ? replacementsFor(picked, order) : [] }
}

/** A replacement sends the same variants again (a line without a variant cannot be sent again). */
export function replacementsFor(items: readonly { id: string; quantity: number }[], order: Pick<Order, "items">): { variant_id: string; quantity: number }[] {
  return items.flatMap((c) => {
    const line = (order.items ?? []).find((i) => i.id === c.id)
    return line?.variant_id ? [{ variant_id: line.variant_id, quantity: c.quantity }] : []
  })
}

/** The same request gives the same text, whatever the order of its lines: the key of an attempt is bound to it. */
export function changeContent(body: ChangeBody): string {
  const lines = (xs: { id?: string; variant_id?: string; quantity: number; reason?: string }[]) =>
    xs.map((x) => `${x.id ?? x.variant_id}x${x.quantity}${x.reason ? `:${x.reason}` : ""}`).sort().join(",")
  if (body.kind === "edit") return `edit|${lines(body.items)}|${lines(body.add)}`
  if (body.kind === "exchange") return `exchange|${lines(body.return_items)}|${lines(body.add)}`
  return `claim|${body.type}|${lines(body.items)}|${lines(body.add)}`
}

/**
 * What a successful change would alter on the order: its version (Medusa counts every confirmed change), its lines and
 * their states. A refund claim moves no total and no quantity, only the written-off count and the version. A new state
 * ends a locked attempt.
 */
export function changeState(order: Pick<Order, "items" | "total" | "version">): string {
  const lines = (order.items ?? [])
    .map((i) => `${i.id}:${num(i.quantity)}:${num(i.detail?.fulfilled_quantity)}:${num(i.detail?.return_requested_quantity)}:${num(i.detail?.written_off_quantity)}`)
    .sort()
    .join(",")
  return `v${num(order.version)}|${lines}|${Math.round(num(order.total) * 100)}`
}

/** Which way the money goes, for the sentence the merchant confirms. */
export const moneyWay = (difference: number): "pay" | "back" | "none" => (difference > 0.004 ? "pay" : difference < -0.004 ? "back" : "none")

export type ChangeErrorCode = "change_open" | "order_closed" | "difference_changed" | "not_allowed"

/** The plugin's refusals of a change that the app words itself; null for anything else (Medusa's own words pass through). */
export function changeErrorCode(err: unknown): ChangeErrorCode | null {
  if (!(err instanceof ApiError)) return null
  const m = err.message
  if (m === "medusify:change_open") return "change_open"
  if (m === "medusify:order_closed") return "order_closed"
  if (m === "medusify:difference_changed") return "difference_changed"
  if (m.startsWith("medusify:not_allowed_")) return "not_allowed"
  return null
}
