/**
 * One idempotency key per attempt, kept outside the sheet that sends it.
 *
 * The shop answers a repeat with the same key as the same refund or return, never as a second one. That only protects as
 * long as the repeat carries the key of the first try. A key that lives in a sheet is lost when the sheet closes or the
 * user goes back, and then a lost answer ("did it go through?") turns into a second refund. So the key lives here, per
 * shop, kind, order and payment, in memory only (order data is never written to device storage, see lib/store.ts).
 *
 *  - Same content on the same order state: same key, however often the sheet is closed, opened or stepped back.
 *  - Other content, or an attempt that was settled (done, or clearly refused): a new key.
 *  - After a lost answer nothing may be sent until the order has been read back. That lock belongs to the order, not to
 *    the amount and not to the sheet: a refund and a return move the same money, and "back, another amount" or "other
 *    sheet" must not open the same hole again.
 *  - Once read back, a changed state (less left to refund, fewer units to return) means the shop did it: the attempt is
 *    over and the sheet starts again from what the order shows now.
 */
type Phase = "sent" | "unread" | "read"
type Entry = { key: string; content: string; state: string; phase: Phase; order: string }

const entries = new Map<string, Entry>()

export type Gate = "open" | "locked" | "landed"

/** `order`: the shop and order this attempt belongs to, e.g. "https://shop|order_1". */
export function gate(scope: string, order: string, state: string): Gate {
  for (const e of entries.values()) if (e.order === order && e.phase === "unread") return "locked"
  const e = entries.get(scope)
  if (e?.phase === "read" && e.state !== state) return "landed"
  return "open"
}

/** The key for sending `content` now. Call it right before the request. */
export function begin(scope: string, order: string, content: string, state: string): string {
  const e = entries.get(scope)
  if (e && e.content === content && e.state === state) {
    e.phase = "sent"
    return e.key
  }
  const key = crypto.randomUUID()
  entries.set(scope, { key, content, state, phase: "sent", order })
  return key
}

/** The answer was lost. `read`: the order was read again afterwards. */
export function lost(scope: string, read: boolean): void {
  const e = entries.get(scope)
  if (e) e.phase = read ? "read" : "unread"
}

/** The order has been read back after a lost answer: every attempt of this order that waited for it is free. */
export function reread(order: string): void {
  for (const e of entries.values()) if (e.order === order && e.phase === "unread") e.phase = "read"
}

/** The key of the attempt in `scope`, if there is one (to ask the shop what became of it). */
export function keyOf(scope: string): string | null {
  return entries.get(scope)?.key ?? null
}

/** The attempt is over: it worked, the shop clearly refused it, or the order shows that it landed. */
export function forget(scope: string): void {
  entries.delete(scope)
}

export function clearAttempts(): void {
  entries.clear()
}
