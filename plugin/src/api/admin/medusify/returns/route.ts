import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ADMIN_ACTIONS } from "../../../../lib/permissions"
import { userMay } from "../../../../lib/rbac"
import { once } from "../../../../lib/return-idempotency"
import { acceptReturnWorkflow } from "../../../../workflows"
import type { PostReturn } from "../validators"

/**
 * POST /admin/medusify/returns — accept a return at the counter: items and quantities, receipt confirmed, optionally
 * the refund in the same step. The middleware has checked return and order rights; a refund needs the refund right too.
 */
export async function POST(req: AuthenticatedMedusaRequest<PostReturn>, res: MedusaResponse) {
  const { order_id, items, refund_amount, note, idempotency_key } = req.validatedBody
  if (refund_amount && !(await userMay(req.scope, req.auth_context.actor_id, ADMIN_ACTIONS.refund))) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "Forbidden")
  }
  const run = async () => {
    const { result } = await acceptReturnWorkflow(req.scope).run({
      input: { order_id, items, refund_amount, note, idempotency_key, created_by: req.auth_context.actor_id },
    })
    return result
  }
  if (!idempotency_key) {
    res.status(201).json(await run())
    return
  }
  // With a key, a repeat (the app sends the same key again after a lost answer) never makes a second return or refund.
  const outcome = await once(req.scope, { orderId: order_id, key: idempotency_key, content: { items, refund_amount } }, run)
  if (outcome.replayed) {
    res.status(200).json({ return_id: outcome.returnId, order_id, refunded: refund_amount ?? 0, replayed: true })
    return
  }
  res.status(201).json(outcome.value)
}
