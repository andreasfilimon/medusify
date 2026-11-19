import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { notifyReturnRequested } from "../lib/notify-order-events"
import { failOpen } from "../lib/fail-open"

export default async function returnRequestedPushHandler({
  event: { data },
  container,
}: SubscriberArgs<{ order_id: string; return_id: string }>) {
  await failOpen(container, `push for return ${data?.return_id}`, () =>
    notifyReturnRequested(container, data.order_id, data.return_id)
  )
}

export const config: SubscriberConfig = {
  event: "order.return_requested",
}
