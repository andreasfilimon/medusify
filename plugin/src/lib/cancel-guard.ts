import type { AuthenticatedMedusaRequest, MedusaNextFunction, MedusaResponse } from "@medusajs/framework/http"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import { refundableOf } from "../workflows/steps/validate-accept-return"
import { ADMIN_ACTIONS } from "./permissions"
import { userMay } from "./rbac"

type PaymentRow = Parameters<typeof refundableOf>[0]

/** How long a second cancel waits for the first one, and when a lost lock frees itself. */
const LOCK_WAIT_SECONDS = 30
const LOCK_EXPIRE_SECONDS = 120

type Locking = {
  execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R>
}

/** What a cancel needs to know and do. Separate from the container so the order of the steps can be tested. */
export type CancelDeps = {
  locking: Locking
  /** The payments of the order, or null when there is no such order. Read fresh on every call. */
  paymentsOf(orderId: string): Promise<PaymentRow[] | null>
  /** Whether the user holds the refund right. */
  mayRefund(): Promise<boolean>
}

/**
 * Medusa refunds every captured payment when it cancels an order (core-flows `refundCapturedPaymentsWorkflow`), yet asks
 * only for the order right. The plugin closes that gap: when captured money is still unrefunded, the refund right is
 * needed as well. `allowed` is true when nothing would be refunded or the user may refund.
 */
export async function cancelAllowed(deps: Pick<CancelDeps, "paymentsOf" | "mayRefund">, orderId: string): Promise<"allowed" | "forbidden" | "missing"> {
  const payments = await deps.paymentsOf(orderId)
  if (payments === null) return "missing"
  const movesMoney = payments.some((p) => refundableOf(p) > 0)
  return !movesMoney || (await deps.mayRefund()) ? "allowed" : "forbidden"
}

/**
 * Cancels the order with the refund rule, check and cancel together under one lock per order. The check reads the order
 * inside the lock and right before `cancel`, so a second cancel that waited for the lock sees the first one's result and
 * not what the order looked like when its request arrived. What the lock cannot stop: Medusa's own capture route and
 * its own cancel route take no lock, so money captured in the milliseconds between this check and the refund step of the
 * workflow is refunded without the check (see plugin/README.md, "Order actions and rights").
 */
export async function cancelOrderChecked(deps: CancelDeps, orderId: string, cancel: () => Promise<unknown>): Promise<void> {
  await deps.locking.execute(
    [`medusify-cancel:${orderId}`],
    async () => {
      const verdict = await cancelAllowed(deps, orderId)
      if (verdict === "missing") throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${orderId} not found`)
      if (verdict === "forbidden") throw new MedusaError(MedusaError.Types.FORBIDDEN, "Forbidden")
      await cancel()
    },
    { timeout: LOCK_WAIT_SECONDS, expire: LOCK_EXPIRE_SECONDS }
  )
}

/**
 * With the plugin option `strictCancelRefund`, the same rule on Medusa's own cancel route (`POST /admin/orders/:id/cancel`),
 * so the desktop admin cannot refund by canceling either. Off by default: switching it on changes what roles may do in
 * an existing shop. The check runs before Medusa's handler; the handler itself takes no lock, so unlike the app's route
 * this one cannot close the milliseconds between check and refund (see plugin/README.md).
 */
export async function strictCancelMiddleware(req: AuthenticatedMedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  try {
    const service = req.scope.resolve(MEDUSIFY_PUSH_MODULE) as MedusifyPushModuleService
    if (!service.getConfig().strictCancelRefund) return next()
    const verdict = await cancelAllowed(depsOf(req.scope, req.auth_context.actor_id), req.params.id)
    // "missing" is Medusa's 404 to give
    if (verdict === "forbidden") throw new MedusaError(MedusaError.Types.FORBIDDEN, "Forbidden")
    next()
  } catch (e) {
    next(e)
  }
}

/** The dependencies of a real request: Medusa's locking module, the order read through Query, the user's roles. */
export function depsOf(container: MedusaContainer, userId: string): CancelDeps {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  return {
    locking: container.resolve(Modules.LOCKING) as unknown as Locking,
    async paymentsOf(orderId) {
      const {
        data: [order],
      } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "payment_collections.payments.id",
          "payment_collections.payments.captured_at",
          "payment_collections.payments.captures.raw_amount",
          "payment_collections.payments.refunds.raw_amount",
        ],
        filters: { id: orderId },
      })
      if (!order) return null
      return (order.payment_collections ?? []).flatMap((c: { payments?: PaymentRow[] | null } | null) => c?.payments ?? [])
    },
    mayRefund: () => userMay(container, userId, ADMIN_ACTIONS.refund),
  }
}
