import type { QueryClient } from "@tanstack/react-query"
import type { Order, Shop } from "./types"

type Located = { shop: Shop; order: Order }

/**
 * Shows "delivered" on the cached order at once. Returns the way back: it puts the cached order as it was. Only for actions
 * that move no money and open no confirmation; the refund, the capture and the cancel are never shown before the shop says yes.
 */
export function optimisticDelivered(qc: QueryClient, orderId: string, fulfillmentId: string, at = new Date().toISOString()): () => void {
  const before = qc.getQueriesData<Located>({ queryKey: ["order"] }).filter(([, d]) => d?.order.id === orderId)
  for (const [key, d] of before) {
    if (!d) continue
    qc.setQueryData<Located>(key, { ...d, order: { ...d.order, fulfillments: d.order.fulfillments?.map((f) => (f.id === fulfillmentId ? { ...f, delivered_at: at } : f)) } })
  }
  return () => {
    for (const [key, d] of before) qc.setQueryData(key, d)
  }
}
