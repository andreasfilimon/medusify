import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, generateEntityId } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import type { SendResult } from "../modules/medusify-push/types"
import { toNumber } from "./bignum"
import { buildLowStockPayload } from "./format"
import { ADMIN_ACTIONS } from "./permissions"
import { cleanThreshold, wantsKind } from "./push-kinds"
import { userMay } from "./rbac"
import { STOCK_SOURCE } from "../workflows/change-stock"

/** At most one message per device and inventory item in this time. */
export const LOW_STOCK_QUIET_MS = 24 * 60 * 60 * 1000
/** Throttle records older than this are of no use any more. */
const ALERT_KEEP_MS = 3 * 24 * 60 * 60 * 1000

export type StockEvent = { id: string; source?: string }

/** A device is told when what can be sold is at or below its threshold (0 = only when it is gone). */
export const isLow = (available: number, threshold: number) => available <= threshold

type Query = { graph(input: Record<string, unknown>): Promise<{ data: any[] }> }
type Pg = { raw(sql: string, bindings: unknown[]): Promise<{ rows: { id: string }[] }> }

/**
 * Takes the right to send one message to one device about one item, or finds it taken. One statement: the row is written
 * when there is none, and refreshed only when the last message is older than the quiet time (`WHERE` on the update). Two
 * events at the same moment, or two backend processes, run the statement one after the other in the database, and only
 * the first gets a row back. Returns whether this call won.
 */
export async function claimAlert(container: MedusaContainer, subscriptionId: string, inventoryItemId: string, now = new Date()): Promise<boolean> {
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Pg
  const cutoff = new Date(now.getTime() - LOW_STOCK_QUIET_MS)
  const result = await pg.raw(
    `INSERT INTO medusify_stock_alert (id, subscription_id, inventory_item_id, last_sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (subscription_id, inventory_item_id) WHERE deleted_at IS NULL
     DO UPDATE SET last_sent_at = EXCLUDED.last_sent_at, updated_at = EXCLUDED.updated_at
     WHERE medusify_stock_alert.last_sent_at < ?
     RETURNING id`,
    [generateEntityId(undefined, "msal"), subscriptionId, inventoryItemId, now, now, now, cutoff]
  )
  return result.rows.length > 0
}

/** Takes back a claim whose message failed. The row it replaced was older than 24 hours, so removing it changes nothing else. */
export async function releaseAlert(container: MedusaContainer, subscriptionId: string, inventoryItemId: string): Promise<void> {
  try {
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Pg
    await pg.raw(`DELETE FROM medusify_stock_alert WHERE subscription_id = ? AND inventory_item_id = ?`, [subscriptionId, inventoryItemId])
  } catch {
    /* the next change after 24 hours tries again */
  }
}

async function sweepAlerts(container: MedusaContainer) {
  try {
    const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Pg
    await pg.raw(`DELETE FROM medusify_stock_alert WHERE last_sent_at < ?`, [new Date(Date.now() - ALERT_KEEP_MS)])
  } catch {
    /* housekeeping only */
  }
}

async function itemOfEvent(query: Query, eventName: string, id: string): Promise<string | null> {
  const entity = eventName === "reservation-item.created" ? "reservation_item" : "inventory_level"
  const { data } = await query.graph({ entity, fields: ["id", "inventory_item_id"], filters: { id } })
  return (data[0]?.inventory_item_id as string | undefined) ?? null
}

/** What can be sold of the item over all locations: stocked minus reserved, summed. */
export async function availableOf(query: Query, inventoryItemId: string): Promise<number> {
  const { data } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "stocked_quantity", "reserved_quantity"],
    filters: { inventory_item_id: inventoryItemId },
  })
  return data.reduce((sum: number, l: { stocked_quantity?: unknown; reserved_quantity?: unknown }) => sum + toNumber(l.stocked_quantity as number) - toNumber(l.reserved_quantity as number), 0)
}

async function nameOf(query: Query, inventoryItemId: string): Promise<{ name: string; productId: string | null }> {
  const { data } = await query.graph({
    entity: "product_variant_inventory_items",
    fields: ["variant.title", "variant.product.id", "variant.product.title", "variant.product.variants.id", "inventory.title", "inventory.sku"],
    filters: { inventory_item_id: inventoryItemId },
  })
  const link = data[0] as { variant?: { title?: string | null; product?: { id?: string; title?: string | null; variants?: unknown[] | null } | null } | null; inventory?: { title?: string | null; sku?: string | null } | null } | undefined
  const product = link?.variant?.product
  if (!product?.title) return { name: link?.inventory?.title || link?.inventory?.sku || inventoryItemId, productId: null }
  const variantTitle = link?.variant?.title
  const several = (product.variants?.length ?? 0) > 1
  return { name: several && variantTitle ? `${product.title} · ${variantTitle}` : product.title, productId: product.id ?? null }
}

/**
 * `reservation-item.created` (an order took stock) and `inventory-level.updated` (stock edited in Medusa, a return
 * received) ⇒ push "low stock" to the devices whose threshold the stock is at or below, that may see stock, that have not
 * switched the kind off and have not been told about this item in the last 24 hours.
 *
 * Changes the app made itself carry `source: "medusify"` and are skipped: the person who counted is looking at the number.
 * May throw: the subscriber wraps it.
 */
export async function notifyLowStock(container: MedusaContainer, eventName: string, event: StockEvent): Promise<SendResult | null> {
  if (event?.source === STOCK_SOURCE || !event?.id) return null
  const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
  if (!service.isEnabled()) return null
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as unknown as Query
  const itemId = await itemOfEvent(query, eventName, event.id)
  if (!itemId) return null
  const available = await availableOf(query, itemId)

  const all = await service.listPushSubscriptions({}, { take: null })
  const wanting = all.filter(
    (s: { disabled_kinds?: unknown; low_stock_threshold?: unknown }) => wantsKind(s.disabled_kinds, "low_stock") && isLow(available, cleanThreshold(s.low_stock_threshold))
  )
  if (wanting.length === 0) return null

  const verdicts = new Map<string, Promise<boolean>>()
  const mayOf = (userId: string) => {
    if (!verdicts.has(userId)) verdicts.set(userId, userMay(container, userId, ADMIN_ACTIONS.stock_read).catch(() => false))
    return verdicts.get(userId)!
  }
  const allowed = await Promise.all(wanting.map((s: { user_id: string }) => mayOf(s.user_id)))
  const eligible = wanting.filter((_: unknown, i: number) => allowed[i])

  const claimed: typeof eligible = []
  for (const sub of eligible) {
    if (await claimAlert(container, sub.id, itemId)) claimed.push(sub)
  }
  void sweepAlerts(container)
  if (claimed.length === 0) return null

  const config = service.getConfig()
  const { name, productId } = await nameOf(query, itemId)
  const payload = buildLowStockPayload({ storeLabel: config.storeLabel, locale: config.locale, inventoryItemId: itemId, productId, name, available })
  const failedIds: string[] = []
  const result = await service.sendToSubscriptions(claimed, payload, failedIds)
  // A message that did not go out has not told anyone: free the 24-hour slot, so the next change tries again.
  for (const id of failedIds) await releaseAlert(container, id, itemId)
  return result
}
