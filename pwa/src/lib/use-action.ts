import { useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useApp } from "../app/context"
import { useToast } from "../ui/Toast"
import { shipFailure } from "./api"
import { singleFlight } from "./single-flight"
import type { Translate } from "./i18n"

/** The sentence for a failed order action. A lost answer is not a refusal: the shop may have done it. */
/** What became of an action that failed: the shop refused it, or the answer was lost (and the order was read again or not). */
export type Outcome = "refused" | "unknown-read" | "unknown-unread"

/**
 * Whether the orders on screen have been read again since `since`: there is an open order query, and every open one is
 * idle, did not end in an error and holds data from after that moment. A refetch that is paused (no network) resolves its
 * promise at once and leaves the old data in place, so the promise alone proves nothing. No open order query (the screen was
 * left while the refresh ran) means nothing was read.
 */
export function ordersReadSince(qc: QueryClient, since: number): boolean {
  const open = qc.getQueryCache().findAll({ queryKey: ["order"], type: "active" })
  return open.length > 0 && open.every((q) => q.state.fetchStatus === "idle" && q.state.status === "success" && q.state.dataUpdatedAt >= since)
}

export function actionErrorText(t: Translate, err: unknown): { text: string; unknown: boolean } {
  const f = shipFailure(err)
  if (f.kind === "unknown") return { text: t("act.failedUnknown"), unknown: true }
  if (f.kind === "auth") return { text: t("act.failedAuth"), unknown: false }
  return { text: t("act.failed", { reason: f.reason ?? t("act.failedGeneric") }), unknown: false }
}

/**
 * Runs one order action at a time. A second tap while one runs is dropped (no second request), a success refreshes the
 * order, the list and the dashboard and shows `done`, a failure stays on screen as text. After a lost answer the shop
 * may have done the action: `busy` stays on until the order has been read again, so the next tap works from what the
 * shop now shows and not from a guess.
 *
 * `onOutcome` hears how a failed action ended (lib/attempt.ts keeps the idempotency key and the lock by it).
 *
 * `optimistic` may show the result before the shop answers and returns the way back. A clear refusal takes it back; a lost
 * answer does not (the shop may have done it): the re-read decides.
 */
export function useAction() {
  const { t } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useMemo(() => {
    const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })])
    return singleFlight(async (action: () => Promise<unknown>, done: string, optimistic?: () => () => void, onOutcome?: (o: Outcome) => void): Promise<boolean> => {
      setBusy(true)
      setError(null)
      const undo = optimistic?.()
      try {
        await action()
        await refresh()
        toast.show(done)
        return true
      } catch (err) {
        const failure = actionErrorText(t, err)
        if (failure.unknown) {
          // Locked from this moment (the refresh below can take a while and the sheet may be gone by then); read back frees it.
          onOutcome?.("unknown-unread")
          const since = Date.now()
          const done = await refresh().then(() => true, () => false)
          if (done && ordersReadSince(qc, since)) onOutcome?.("unknown-read")
        } else {
          undo?.()
          onOutcome?.("refused")
        }
        setError(failure.text)
        return false
      } finally {
        setBusy(false)
      }
    })
  }, [qc, toast, t])

  return { run, busy, error, clearError: () => setError(null) }
}
