import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import type { SendResult } from "../modules/medusify-push/types"
import { toNumber } from "./bignum"
import { countToShipSafe } from "./to-ship"
import { buildOrderPlacedPayload } from "./format"
import { canReadOrders } from "./rbac"

/**
 * Loads the order and pushes "new order" to the subscriptions of the shop whose user may read orders.
 * May throw — the subscriber wraps it fail-open.
 */
export async function notifyOrderPlaced(
  container: MedusaContainer,
  orderId: string
): Promise<SendResult | null> {
  const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
  if (!service.isEnabled()) {
    return null
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    fields: ["id", "display_id", "currency_code", "summary.current_order_total", "items.quantity"],
    filters: { id: orderId },
  })
  if (!order) {
    return null
  }

  const itemCount = (order.items ?? []).reduce(
    (sum: number, item: { quantity?: unknown } | null) => sum + toNumber(item?.quantity as number),
    0
  )
  const config = service.getConfig()
  const payload = buildOrderPlacedPayload({
    storeLabel: config.storeLabel,
    locale: config.locale,
    orderId: order.id,
    displayId: order.display_id,
    amount: toNumber(order.summary?.current_order_total),
    currencyCode: order.currency_code,
    itemCount,
    toShip: await countToShipSafe(container),
  })
  // Only admins who may read orders (Medusa RBAC) get the message; without the RBAC module this is everyone.
  return service.sendToAll(payload, (userId) => canReadOrders(container, userId))
}
