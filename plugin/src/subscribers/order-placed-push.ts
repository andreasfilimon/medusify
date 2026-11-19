import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { failOpen } from "../lib/fail-open"
import { notifyOrderPlaced } from "../lib/notify-order-placed"

export default async function orderPlacedPushHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  await failOpen(container, `push for order ${data?.id}`, () => notifyOrderPlaced(container, data.id))
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
