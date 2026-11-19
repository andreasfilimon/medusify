import { useQueryClient } from "@tanstack/react-query"
import { useReducer } from "react"
import * as attempt from "./attempt"
import { ordersReadSince, type Outcome } from "./use-action"

/**
 * The idempotency key and the lock of one attempt (see lib/attempt.ts) for a sheet. `order` names shop and order (the lock
 * covers all sheets of it). `state` is whatever the order shows
 * that a successful attempt would change (what is left to refund, which units can still come back).
 */
export function useAttempt(scope: string, order: string, state: string) {
  const qc = useQueryClient()
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  return {
    gate: attempt.gate(scope, order, state),
    /** The key to send with the request. */
    begin: (content: string) => attempt.begin(scope, order, content, state),
    /** Pass to `run` as `onOutcome`. */
    onOutcome: (o: Outcome) => (o === "refused" ? attempt.forget(scope) : attempt.lost(scope, o === "unknown-read")),
    done: () => attempt.forget(scope),
    /** Read the order again; a lock opens only when that worked. */
    reload: async () => {
      try {
        const since = Date.now()
        await qc.refetchQueries({ queryKey: ["order"], type: "active" }, { throwOnError: true })
        if (ordersReadSince(qc, since)) attempt.reread(order)
      } catch {
        // stays locked
      }
      redraw()
    },
  }
}
