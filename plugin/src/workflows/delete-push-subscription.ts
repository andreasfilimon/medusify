import { WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"
import {
  type DeletePushSubscriptionInput,
  deletePushSubscriptionStep,
} from "./steps/delete-push-subscription"

export const deletePushSubscriptionWorkflow = createWorkflow(
  "medusify-delete-push-subscription-workflow",
  function (input: DeletePushSubscriptionInput) {
    const result = deletePushSubscriptionStep(input)
    return new WorkflowResponse(result)
  }
)
