import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { applyChange } from "../../../../../../lib/order-change"
import type { PostOrderChange } from "../../../validators"
import { orderLock, refuseWithoutRight, toRequest, type Locking } from "./shared"

/**
 * POST /admin/medusify/orders/:id/change — edit, exchange or claim, with the difference the merchant confirmed. A
 * different difference now is a `409 medusify:difference_changed` and changes nothing; a repeat of the key answers from
 * the first result (`200`, `replayed`).
 */
export async function POST(req: AuthenticatedMedusaRequest<PostOrderChange>, res: MedusaResponse) {
  const body = req.validatedBody
  await refuseWithoutRight(req.scope, req.auth_context.actor_id, body.change.kind)
  const locking = req.scope.resolve(Modules.LOCKING) as unknown as Locking
  const done = await locking.execute(
    orderLock(req.params.id),
    () => applyChange(req.scope, req.params.id, toRequest(body.change), { key: body.idempotency_key, expected_difference: body.expected_difference, actor: req.auth_context.actor_id }),
    { timeout: 60, expire: 120 }
  )
  res.status(done.replayed ? 200 : 201).json(done)
}
