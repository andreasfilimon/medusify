import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { notifyOrderPlaced } from "../lib/notify-order-placed"

/**
 * Fail-open: a push problem must never disturb an order. Everything is caught and logged,
 * nothing is thrown to the event bus.
 */
export default async function orderPlacedPushHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  try {
    await notifyOrderPlaced(container, data.id)
  } catch (error) {
    try {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      logger.error(
        `[medusify] push for order ${data?.id} failed (ignored): ${(error as Error)?.message ?? error}`
      )
    } catch {
      // not even logging worked — still must not throw
    }
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
