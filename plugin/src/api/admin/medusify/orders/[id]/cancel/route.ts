import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { cancelOrderChecked, depsOf } from "../../../../../../lib/cancel-guard"

/**
 * POST /admin/medusify/orders/:id/cancel — cancel an order, the way Medusa's own route does, with one more check.
 *
 * `cancelOrderWorkflow` refunds every captured payment (core-flows `refundCapturedPaymentsWorkflow`). Medusa's cancel
 * route only asks for the order right, so a role without the refund right could give money back by canceling. The app
 * goes through this route instead: when money was captured and is not yet refunded, the user needs the refund right too.
 * Check and cancel run under one lock per order (lib/cancel-guard.ts).
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const orderId = req.params.id
  const userId = req.auth_context.actor_id
  await cancelOrderChecked(depsOf(req.scope, userId), orderId, () =>
    cancelOrderWorkflow(req.scope).run({ input: { order_id: orderId, canceled_by: userId } })
  )
  res.status(200).json({ order_id: orderId })
}
