import { MedusaError, ContainerRegistrationKeys, MathBN } from "@medusajs/framework/utils"
import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { toBN } from "../../lib/bignum"

export type AcceptReturnInput = {
  order_id: string
  items: { id: string; quantity: number }[]
  /** Money to give back right away. Absent or 0 ⇒ no refund. */
  refund_amount?: number
  note?: string
  created_by?: string | null
  /** From the app, one per attempt. Kept on the return so a repeat is recognised (see lib/return-idempotency.ts). */
  idempotency_key?: string
}

type PaymentRow = {
  id: string
  captured_at?: string | null
  captures?: { raw_amount?: unknown; amount?: unknown }[] | null
  refunds?: { raw_amount?: unknown; amount?: unknown }[] | null
}

/** Captured minus refunded of one payment. Exported for tests. */
export function refundableOf(payment: PaymentRow): number {
  const sum = (rows: PaymentRow["captures"]) =>
    (rows ?? []).reduce((acc: ReturnType<typeof toBN>, row) => MathBN.add(acc, toBN(row.raw_amount ?? row.amount ?? 0)), toBN(0))
  return MathBN.sub(sum(payment.captures), sum(payment.refunds)).toNumber()
}

/**
 * Everything that can be checked up front is checked here, before the first change is written: a return that stops
 * halfway would leave the order with an open return the merchant did not ask for.
 */
export const validateAcceptReturnStep = createStep(
  "medusify-validate-accept-return",
  async (input: AcceptReturnInput, { container }) => {
    if (!input.items.length) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Choose at least one item to return.")
    }
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const {
      data: [order],
    } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "status",
        "items.id",
        "payment_collections.payments.id",
        "payment_collections.payments.captured_at",
        "payment_collections.payments.captures.raw_amount",
        "payment_collections.payments.refunds.raw_amount",
      ],
      filters: { id: input.order_id },
    })
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.order_id} not found`)
    }
    if (order.status === "canceled") {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "A canceled order cannot get a return.")
    }
    const known = new Set((order.items ?? []).map((i: { id: string }) => i.id))
    const unknown = input.items.find((i) => !known.has(i.id))
    if (unknown) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, `Item ${unknown.id} is not part of order ${order.id}`)
    }

    let paymentId: string | null = null
    if (input.refund_amount && input.refund_amount > 0) {
      const payments: PaymentRow[] = (order.payment_collections ?? []).flatMap(
        (c: { payments?: PaymentRow[] | null } | null) => c?.payments ?? []
      )
      const captured = payments.filter((p) => p.captured_at)
      const payment = captured.find((p) => refundableOf(p) >= input.refund_amount!) ?? null
      if (!payment) {
        const most = captured.reduce((max, p) => Math.max(max, refundableOf(p)), 0)
        throw new MedusaError(
          MedusaError.Types.INVALID_DATA,
          `The refund of ${input.refund_amount} is more than the ${most} that can still be refunded.`
        )
      }
      paymentId = payment.id
    }
    return new StepResponse({ payment_id: paymentId })
  }
)
