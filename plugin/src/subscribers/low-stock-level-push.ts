import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { failOpen } from "../lib/fail-open"
import { type StockEvent, notifyLowStock } from "../lib/low-stock"

export default async function lowStockLevelPushHandler({ event: { name, data }, container }: SubscriberArgs<StockEvent>) {
  await failOpen(container, `low-stock push for ${name} ${data?.id}`, () => notifyLowStock(container, name, data))
}

export const config: SubscriberConfig = {
  event: "inventory-level.updated",
}
