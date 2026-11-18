import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { MEDUSIFY_PUSH_MODULE } from "../../constants"
import type { MedusifyPushModuleService } from "../../modules/medusify-push"

export type DeletePushSubscriptionInput = {
  user_id: string
  endpoint: string
}

/** Deletes only the calling user's subscription for this endpoint. Idempotent. */
export const deletePushSubscriptionStep = createStep(
  "medusify-delete-push-subscription",
  async (input: DeletePushSubscriptionInput, { container }) => {
    const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    const found = await service.listPushSubscriptions(
      { endpoint: input.endpoint, user_id: input.user_id },
      { take: null }
    )
    if (found.length) {
      await service.deletePushSubscriptions(found.map((s) => s.id))
    }
    return new StepResponse({ deleted: found.length }, found)
  },
  async (deleted, { container }) => {
    if (!deleted?.length) return
    const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    await service.createPushSubscriptions(
      deleted.map((s) => ({
        endpoint: s.endpoint,
        p256dh: s.p256dh,
        auth: s.auth,
        user_id: s.user_id,
        user_agent: s.user_agent,
        last_success_at: s.last_success_at,
        failure_count: s.failure_count,
      }))
    )
  }
)
