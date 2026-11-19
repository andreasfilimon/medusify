import {
  beginReceiveReturnWorkflow,
  beginReturnOrderWorkflow,
  confirmReturnReceiveWorkflow,
  confirmReturnRequestWorkflow,
  receiveItemReturnRequestWorkflow,
  refundPaymentWorkflow,
  requestItemReturnWorkflow,
} from "@medusajs/medusa/core-flows"
import { WorkflowResponse, createWorkflow, transform, when } from "@medusajs/framework/workflows-sdk"
import { IDEMPOTENCY_FINGERPRINT_FIELD, IDEMPOTENCY_KEY_FIELD, fingerprintOf } from "../lib/return-idempotency"
import { RETURN_SOURCE_APP, RETURN_SOURCE_KEY } from "../lib/return-source"
import { type AcceptReturnInput, validateAcceptReturnStep } from "./steps/validate-accept-return"

export const acceptReturnWorkflowId = "medusify-accept-return"

/**
 * Takes a return in at the counter: the customer sends goods back, the merchant ticks what arrived. In Medusa's terms
 * this is request, confirm, receive, confirm receipt, and on request the refund. The core routes need six calls for
 * it; here it is one workflow, so a dropped connection cannot leave a half-open return behind (the nested workflows
 * roll back together).
 *
 * The return is marked as entered by the app, so the "return requested" push skips it.
 */
export const acceptReturnWorkflow = createWorkflow(acceptReturnWorkflowId, function (input: AcceptReturnInput) {
  const checked = validateAcceptReturnStep(input)

  const begun = beginReturnOrderWorkflow.runAsStep({
    input: transform({ input, checked }, ({ input }) => ({
      order_id: input.order_id,
      created_by: input.created_by ?? null,
      internal_note: input.note,
      metadata: {
        [RETURN_SOURCE_KEY]: RETURN_SOURCE_APP,
        ...(input.idempotency_key
          ? { [IDEMPOTENCY_KEY_FIELD]: input.idempotency_key, [IDEMPOTENCY_FINGERPRINT_FIELD]: fingerprintOf(input) }
          : {}),
      },
    })),
  })

  const requested = requestItemReturnWorkflow.runAsStep({
    input: transform({ begun, input }, ({ begun, input }) => ({
      return_id: (begun as { return_id: string }).return_id,
      items: input.items.map((i) => ({ id: i.id, quantity: i.quantity })),
    })),
  })

  const confirmed = confirmReturnRequestWorkflow.runAsStep({
    input: transform({ begun, requested, input }, ({ begun, input }) => ({
      return_id: (begun as { return_id: string }).return_id,
      confirmed_by: input.created_by ?? undefined,
    })),
  })

  const receiving = beginReceiveReturnWorkflow.runAsStep({
    input: transform({ begun, confirmed, input }, ({ begun, input }) => ({
      return_id: (begun as { return_id: string }).return_id,
      created_by: input.created_by ?? undefined,
    })),
  })

  const received = receiveItemReturnRequestWorkflow.runAsStep({
    input: transform({ begun, receiving, input }, ({ begun, input }) => ({
      return_id: (begun as { return_id: string }).return_id,
      items: input.items.map((i) => ({ id: i.id, quantity: i.quantity })),
    })),
  })

  confirmReturnReceiveWorkflow.runAsStep({
    input: transform({ begun, received, input }, ({ begun, input }) => ({
      return_id: (begun as { return_id: string }).return_id,
      confirmed_by: input.created_by ?? undefined,
    })),
  })

  when({ checked, input }, ({ checked, input }) => !!checked.payment_id && !!input.refund_amount).then(() => {
    refundPaymentWorkflow.runAsStep({
      input: transform({ checked, input }, ({ checked, input }) => ({
        payment_id: checked.payment_id as string,
        amount: input.refund_amount as number,
        created_by: input.created_by ?? undefined,
        note: input.note,
        // Forwarded to the payment provider and kept by Medusa (unique per payment): a refund the lock did not catch
        // still cannot happen twice. Medusa versions before it was added ignore the field.
        idempotency_key: input.idempotency_key ? `${input.idempotency_key}-refund` : undefined,
      })),
    })
  })

  return new WorkflowResponse(
    transform({ begun, input, checked }, ({ begun, input, checked }) => ({
      return_id: (begun as { return_id: string }).return_id,
      order_id: input.order_id,
      refunded: !!checked.payment_id && !!input.refund_amount ? input.refund_amount : 0,
    }))
  )
})
