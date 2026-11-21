import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import { toNumber, type Amount } from "./bignum"

/**
 * What an order by hand with this key came to:
 *  - none: nothing was made (no record, or a try that stopped before the order existed); a send makes it now.
 *  - done: the order is there and complete.
 *  - incomplete: the order is there, but the try stopped before it was finished (marked paid). It is not made again;
 *    the merchant finishes it on the order.
 */
export type ManualOrderAttempt =
  | { state: "none" }
  | { state: "done" | "incomplete"; order_id: string; display_id: number | null }

type Stored = { state?: "pending" | "done"; paid?: boolean; order_id?: string; display_id?: number | null }
type Found = { id: string; display_id?: number | null; status?: string; total?: Amount; metadata?: Record<string, unknown> | null; payment_collections?: { status?: string }[] | null }

/** Answers from the record of the key; a pending one is settled by looking for the order that carries the key. */
export async function settleManualOrder(container: MedusaContainer, key: string): Promise<ManualOrderAttempt> {
  const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
  const [op] = await push.listMedusifyOperations({ key, kind: "manual_order" }, { take: 1 })
  if (!op) return { state: "none" }
  const stored = op.result as Stored
  // records of 0.3.0 carry no state: they were written when the order was made
  if (stored.state !== "pending") return { state: "done", order_id: stored.order_id!, display_id: stored.display_id ?? null }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const since = new Date(new Date(op.created_at as unknown as string).getTime() - 60_000)
  const { data } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "status", "total", "metadata", "payment_collections.status"],
    filters: { created_at: { $gte: since } },
    pagination: { take: 500, order: { created_at: "ASC" } },
  })
  const order = (data as Found[]).find((o) => o.metadata?.medusify_key === key)
  if (!order) {
    // the try stopped before the order existed (or its rollback took it back): nothing to answer with
    await push.deleteMedusifyOperations([op.id])
    return { state: "none" }
  }
  const display_id = order.display_id ?? null
  // payment_status is not stored on the order (Medusa computes it for its own routes); the collection says it
  const paidDone = !stored.paid || toNumber(order.total) <= 0 || (order.payment_collections ?? []).some((c) => c.status === "completed")
  if (order.status !== "draft" && paidDone) {
    await push.updateMedusifyOperations({ id: op.id, result: { ...stored, state: "done", order_id: order.id, display_id } })
    return { state: "done", order_id: order.id, display_id }
  }
  return { state: "incomplete", order_id: order.id, display_id }
}
