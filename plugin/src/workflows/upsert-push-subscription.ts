import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import {
  type UpsertPushSubscriptionInput,
  upsertPushSubscriptionStep,
} from "./steps/upsert-push-subscription"

export const upsertPushSubscriptionWorkflow = createWorkflow(
  "medusify-upsert-push-subscription-workflow",
  function (input: UpsertPushSubscriptionInput) {
    const result = upsertPushSubscriptionStep(input)
    return new WorkflowResponse(result)
  }
)
