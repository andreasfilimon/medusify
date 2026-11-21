import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { ADMIN_ACTIONS } from "../../../../lib/permissions"
import { userMay } from "../../../../lib/rbac"
import { settleManualOrder } from "../../../../lib/manual-order-attempt"
import { manualOrderWorkflow } from "../../../../workflows/manual-order"
import type { PostManualOrder } from "../validators"

type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

/**
 * POST /admin/medusify/orders — an order taken by hand. The key makes a repeat (a second tap, a retry after a lost answer)
 * answer with the same order: 200 with `replayed`, the first answer is 201. A repeat of a try that stopped half-way answers
 * with its order and `incomplete` (made, not yet marked paid) instead of making a second one (lib/manual-order-attempt.ts). Marking it paid at once needs the right to
 * mark payments as paid; without it the request is refused before anything is made.
 */
export async function POST(req: AuthenticatedMedusaRequest<PostManualOrder>, res: MedusaResponse) {
  const body = req.validatedBody
  if (body.paid && !(await userMay(req.scope, req.auth_context.actor_id, ADMIN_ACTIONS.mark_paid))) {
    throw new MedusaError(MedusaError.Types.FORBIDDEN, "medusify:not_allowed_paid")
  }
  const locking = req.scope.resolve(Modules.LOCKING) as unknown as Locking
  const done = await locking.execute(
    [`medusify-manual-order:${body.idempotency_key}`],
    async () => {
      const prior = await settleManualOrder(req.scope, body.idempotency_key)
      if (prior.state !== "none") return { order_id: prior.order_id, display_id: prior.display_id, replayed: true, incomplete: prior.state === "incomplete" }
      const { result } = await manualOrderWorkflow(req.scope).run({
        input: {
          key: body.idempotency_key,
          region_id: body.region_id,
          email: body.email ?? null,
          customer_id: body.customer_id ?? null,
          items: body.items,
          shipping_option_id: body.shipping_option_id ?? null,
          shipping_address: body.shipping_address ?? null,
          paid: body.paid,
          actor_id: req.auth_context.actor_id,
        },
      })
      return { ...result, replayed: false, incomplete: false }
    },
    { timeout: 60, expire: 120 }
  )
  res.status(done.replayed ? 200 : 201).json(done)
}
