import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import type { SendResult } from "../modules/medusify-push/types"
import { toNumber } from "./bignum"
import { buildOrderCanceledPayload, buildReturnRequestedPayload } from "./format"
import { canReadOrders } from "./rbac"
import { RETURN_SOURCE_APP, RETURN_SOURCE_KEY } from "./return-source"
import { countToShipSafe } from "./to-ship"

/** `order.canceled` ⇒ push "order canceled" to devices that have not switched it off. May throw: the subscriber wraps it. */
export async function notifyOrderCanceled(container: MedusaContainer, orderId: string): Promise<SendResult | null> {
  const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
  if (!service.isEnabled()) return null
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "currency_code", "summary.original_order_total"],
    filters: { id: orderId },
  })
  if (!order) return null
  const config = service.getConfig()
  const payload = buildOrderCanceledPayload({
    storeLabel: config.storeLabel,
    locale: config.locale,
    orderId: order.id,
    displayId: order.display_id,
    // After the cancel the order's current total (and `total`) is 0; `original_order_total` is what it was worth.
    amount: toNumber(order.summary?.original_order_total),
    currencyCode: order.currency_code,
    toShip: await countToShipSafe(container),
  })
  return service.sendToAll(payload, (userId) => canReadOrders(container, userId), "canceled")
}

/**
 * `order.return_requested` ⇒ push "return requested". Skips returns the app entered itself and returns that are
 * already received (an in-person return confirmed in the same request).
 */
export async function notifyReturnRequested(
  container: MedusaContainer,
  orderId: string,
  returnId: string
): Promise<SendResult | null> {
  const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
  if (!service.isEnabled()) return null
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [orderReturn],
  } = await query.graph({
    entity: "return",
    fields: ["id", "order_id", "metadata", "items.quantity", "order.id", "order.display_id"],
    filters: { id: returnId },
  })
  if (!orderReturn) return null
  if ((orderReturn.metadata as Record<string, unknown> | null)?.[RETURN_SOURCE_KEY] === RETURN_SOURCE_APP) return null
  const displayId = orderReturn.order?.display_id
  if (displayId === undefined || displayId === null) return null
  const itemCount = (orderReturn.items ?? []).reduce(
    (sum: number, item: { quantity?: unknown } | null) => sum + toNumber(item?.quantity as number),
    0
  )
  const config = service.getConfig()
  const payload = buildReturnRequestedPayload({
    storeLabel: config.storeLabel,
    locale: config.locale,
    orderId,
    returnId,
    displayId,
    itemCount,
    toShip: await countToShipSafe(container),
  })
  return service.sendToAll(payload, (userId) => canReadOrders(container, userId), "return_requested")
}
