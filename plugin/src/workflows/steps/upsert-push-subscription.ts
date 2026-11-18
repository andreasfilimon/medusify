import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { MEDUSIFY_PUSH_MODULE } from "../../constants"
import type { MedusifyPushModuleService } from "../../modules/medusify-push"

export type UpsertPushSubscriptionInput = {
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent?: string | null
}

type Compensation =
  | { kind: "created"; id: string }
  | { kind: "updated"; previous: Record<string, unknown> }

/** Idempotent per endpoint: same endpoint again ⇒ update (and move to the calling user). */
export const upsertPushSubscriptionStep = createStep(
  "medusify-upsert-push-subscription",
  async (input: UpsertPushSubscriptionInput, { container }) => {
    const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    const [existing] = await service.listPushSubscriptions(
      { endpoint: input.endpoint },
      { take: 1 }
    )

    if (existing) {
      const updated = await service.updatePushSubscriptions({
        id: existing.id,
        user_id: input.user_id,
        p256dh: input.p256dh,
        auth: input.auth,
        user_agent: input.user_agent ?? null,
        failure_count: 0,
      })
      return new StepResponse(
        { subscription: updated, created: false },
        { kind: "updated", previous: existing } as Compensation
      )
    }

    const created = await service.createPushSubscriptions({
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      user_id: input.user_id,
      user_agent: input.user_agent ?? null,
      failure_count: 0,
    })
    return new StepResponse(
      { subscription: created, created: true },
      { kind: "created", id: created.id } as Compensation
    )
  },
  async (compensation, { container }) => {
    if (!compensation) return
    const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    if (compensation.kind === "created") {
      await service.deletePushSubscriptions(compensation.id)
    } else {
      const { id, user_id, p256dh, auth, user_agent, failure_count } =
        compensation.previous as Record<string, any>
      await service.updatePushSubscriptions({
        id,
        user_id,
        p256dh,
        auth,
        user_agent,
        failure_count,
      })
    }
  }
)
