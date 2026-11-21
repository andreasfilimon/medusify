import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { previewChange } from "../../../../../../../lib/order-change"
import type { PostOrderChangePreview } from "../../../../validators"
import { orderLock, refuseWithoutRight, toRequest, type Locking } from "../shared"

/** POST /admin/medusify/orders/:id/change/preview — what the change does to the money; nothing stays changed. */
export async function POST(req: AuthenticatedMedusaRequest<PostOrderChangePreview>, res: MedusaResponse) {
  const body = req.validatedBody
  await refuseWithoutRight(req.scope, req.auth_context.actor_id, body.change.kind)
  const locking = req.scope.resolve(Modules.LOCKING) as unknown as Locking
  const money = await locking.execute(orderLock(req.params.id), () => previewChange(req.scope, req.params.id, toRequest(body.change), req.auth_context.actor_id), { timeout: 60, expire: 120 })
  res.json(money)
}
