import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { notifyOrderCanceled } from "../lib/notify-order-events"
import { failOpen } from "../lib/fail-open"

export default async function orderCanceledPushHandler({ event: { data }, container }: SubscriberArgs<{ id: string }>) {
  await failOpen(container, `push for canceled order ${data?.id}`, () => notifyOrderCanceled(container, data.id))
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
