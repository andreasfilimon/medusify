import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  deletePushSubscriptionWorkflow,
  upsertPushSubscriptionWorkflow,
} from "../../../../workflows"
import type { DeletePushSubscription, PostPushSubscription } from "../validators"

export async function POST(
  req: AuthenticatedMedusaRequest<PostPushSubscription>,
  res: MedusaResponse
) {
  const { endpoint, keys, user_agent } = req.validatedBody
  const { result } = await upsertPushSubscriptionWorkflow(req.scope).run({
    input: {
      user_id: req.auth_context.actor_id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: user_agent ?? (req.headers["user-agent"] as string | undefined) ?? null,
    },
  })
  res.status(result.created ? 201 : 200).json({
    created: result.created,
    subscription: { id: result.subscription.id, endpoint: result.subscription.endpoint },
  })
}

export async function DELETE(
  req: AuthenticatedMedusaRequest<DeletePushSubscription>,
  res: MedusaResponse
) {
  const { result } = await deletePushSubscriptionWorkflow(req.scope).run({
    input: { user_id: req.auth_context.actor_id, endpoint: req.validatedBody.endpoint },
  })
  res.json({ deleted: result.deleted })
}
