import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  createOrderFulfillmentWorkflow,
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"

/** How long a second ship request for the same order waits for the first one, and when a lost lock frees itself. */
const LOCK_WAIT_SECONDS = 30
const LOCK_EXPIRE_SECONDS = 120

/** The message of the refusal when one typed number would fit several packages; the app recognises it. */
export const NUMBERS_REQUIRED = "medusify:numbers_required"

export type ShipRequest = {
  orderId: string
  userId: string
  notify: boolean
  location_id?: string
  /** The number of the package packed now (the fulfillments this request creates), or of the only open one. */
  tracking_number?: string
  tracking_url?: string
  /** Numbers for packages that exist already (packed in the Medusa admin or left by an earlier try), by fulfillment id. */
  numbers?: Record<string, string>
}

export type ShipResult = {
  order_id: string
  /** Fulfillments marked as shipped by this request, with the tracking numbers they carry now. */
  shipped: { fulfillment_id: string; tracking_numbers: string[] }[]
  /** Fulfillments without shipping (no parcel) marked as delivered. */
  delivered: string[]
  /** True when there was nothing left to do: a repeat after a lost answer, or an order shipped elsewhere. */
  nothing_to_do: boolean
  /** A number was typed and went on no package (no package left to ship, all with numbers of their own); the app says so. */
  unused_tracking_number: boolean
}

type Label = { tracking_number: string; tracking_url: string; label_url: string }

export type ShipOrderData = {
  id: string
  status: string
  items: {
    id: string
    quantity: number
    requires_shipping?: boolean | null
    detail?: { fulfilled_quantity?: number | null } | null
    variant?: { product?: { shipping_profile?: { id?: string | null } | null } | null } | null
  }[]
  shipping_methods: { shipping_option_id?: string | null }[]
  fulfillments: {
    id: string
    shipped_at?: unknown
    canceled_at?: unknown
    delivered_at?: unknown
    requires_shipping?: boolean | null
    items?: { line_item_id: string; quantity: number }[]
    labels?: { tracking_number?: string | null; tracking_url?: string | null; label_url?: string | null }[]
  }[]
}

export type FulfillmentGroup = { items: { id: string; quantity: number }[]; shipping_option_id?: string; requires_shipping: boolean }

const isOpen = (f: ShipOrderData["fulfillments"][number]) => !f.shipped_at && !f.canceled_at && !f.delivered_at

/**
 * The lines still to fulfill, split the way Medusa accepts them: one fulfillment holds either goods to ship or goods
 * without shipping (core-flows order-validation `throwIfItemsAreNotGroupedByShippingRequirement`), and goods to ship
 * only of the shipping profile of its shipping option (create-fulfillment `prepareFulfillmentData`). Each group gets the
 * order's shipping method whose option has the group's profile; without one Medusa's own choice applies (the first
 * method), which fails with Medusa's message. Items without a product (custom lines) fit every profile.
 */
export function groupsToFulfill(order: ShipOrderData, profileOfOption: Map<string, string>): FulfillmentGroup[] {
  const remaining = order.items
    .map((i) => ({ item: i, quantity: Number(i.quantity) - Number(i.detail?.fulfilled_quantity ?? 0) }))
    .filter((r) => r.quantity > 0)
  const methods = order.shipping_methods.map((m) => m.shipping_option_id).filter((x): x is string => !!x)
  const groups = new Map<string, FulfillmentGroup>()
  for (const { item, quantity } of remaining) {
    const ships = item.requires_shipping !== false
    const profile = item.variant?.product?.shipping_profile?.id ?? undefined
    const key = ships ? `ship:${profile ?? ""}` : "noship"
    let group = groups.get(key)
    if (!group) {
      const option = ships && profile ? methods.find((m) => profileOfOption.get(m) === profile) : undefined
      group = { items: [], shipping_option_id: option, requires_shipping: ships }
      groups.set(key, group)
    }
    group.items.push({ id: item.id, quantity })
  }
  // Custom lines (no profile) join a group with a profile instead of making a parcel of their own.
  const loose = groups.get("ship:")
  const withProfile = [...groups.entries()].find(([k]) => k.startsWith("ship:") && k !== "ship:")
  if (loose && withProfile) {
    withProfile[1].items.push(...loose.items)
    groups.delete("ship:")
  }
  return [...groups.values()]
}

/**
 * The stock location for one group. The app offers the locations of the order's first shipping option, so the choice
 * applies to the group of that option (and to groups without an option of their own). A group with another option gets
 * none, and Medusa takes the location of that option's fulfillment set; otherwise the second parcel of an order split by
 * shipping profile would be booked at the first one's warehouse (review 2026-11-19).
 */
export function locationFor(group: Pick<FulfillmentGroup, "shipping_option_id">, methodOptions: readonly string[], chosen: string | undefined): string | undefined {
  return group.shipping_option_id && group.shipping_option_id !== methodOptions[0] ? undefined : chosen
}

const httpOrEmpty = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : "")

/**
 * Which package the typed number (`tracking_number`) belongs to: the parcel packed by this request, or, when this request
 * packed none (nothing, or only goods without shipping such as a voucher), the only parcel waiting for its shipment. Packages with a number of their own (`numbers`) are not candidates.
 * With two or more candidates the number fits none of them for sure (an order split by shipping profile, or several
 * packages packed in the Medusa admin): `ambiguous`, and the caller asks for one number per package instead of putting
 * the same number on all (review 2026-11-19).
 */
export function mainNumberTarget(
  openShipping: readonly string[],
  created: ReadonlySet<string>,
  numbers: Readonly<Record<string, string>> | undefined,
): { target?: string; ambiguous: boolean } {
  const packedNow = openShipping.filter((id) => created.has(id))
  const pool = packedNow.length > 0 ? packedNow : [...openShipping]
  const candidates = pool.filter((id) => !numbers?.[id])
  if (candidates.length === 1) return { target: candidates[0], ambiguous: false }
  return { ambiguous: candidates.length > 1 }
}

/**
 * The labels a fulfillment carries after its shipment. Medusa replaces the labels of a fulfillment with the list in the
 * shipment call (measured: no list ⇒ none left, a typed number ⇒ only that one), so the labels a carrier integration
 * wrote when the fulfillment was created go in again, unchanged: a carrier may keep a relative path to its label PDF in
 * `label_url`, which only Medusa's HTTP route would refuse (this runs the workflow). A typed number is added unless it is
 * one of them; its URL was checked by the route's validator (http(s) or nothing).
 */
export function labelsFor(existing: ShipOrderData["fulfillments"][number]["labels"], typed?: { number?: string; url?: string }): Label[] {
  const labels: Label[] = (existing ?? [])
    .filter((l) => l.tracking_number)
    .map((l) => ({ tracking_number: l.tracking_number!, tracking_url: l.tracking_url ?? "", label_url: l.label_url ?? "" }))
  const number = typed?.number?.trim()
  if (number && !labels.some((l) => l.tracking_number === number)) {
    labels.push({ tracking_number: number, tracking_url: httpOrEmpty(typed?.url), label_url: "" })
  }
  return labels
}

const ORDER_FIELDS = [
  "id",
  "status",
  "items.id",
  "items.quantity",
  "items.requires_shipping",
  "items.detail.fulfilled_quantity",
  "items.variant.product.shipping_profile.id",
  "shipping_methods.shipping_option_id",
  "fulfillments.id",
  "fulfillments.shipped_at",
  "fulfillments.canceled_at",
  "fulfillments.delivered_at",
  "fulfillments.requires_shipping",
  "fulfillments.items.line_item_id",
  "fulfillments.items.quantity",
  "fulfillments.labels.tracking_number",
  "fulfillments.labels.tracking_url",
  "fulfillments.labels.label_url",
]

async function readOrder(container: MedusaContainer, orderId: string): Promise<ShipOrderData | null> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({ entity: "order", fields: ORDER_FIELDS, filters: { id: orderId } })
  return (order as unknown as ShipOrderData) ?? null
}

async function profilesOf(container: MedusaContainer, optionIds: string[]): Promise<Map<string, string>> {
  if (optionIds.length === 0) return new Map()
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "shipping_option", fields: ["id", "shipping_profile_id"], filters: { id: optionIds } })
  return new Map((data as { id: string; shipping_profile_id: string }[]).map((o) => [o.id, o.shipping_profile_id]))
}

/**
 * Ships an order in one request: creates the fulfillments that are missing, then registers the shipment of every open
 * fulfillment, all on the server. Before, the app made these calls one by one, and when iOS put the app away between them
 * the order stayed packed but not shipped, without the customer's mail (measured in a live shop, 2026-11-19).
 *
 * Runs under one lock per order and reads the order inside it, so a repeat (a lost answer, a second tap, a second device)
 * finds the work done and changes nothing. A failure halfway leaves fulfillments that the next call picks up.
 */
export async function shipOrder(container: MedusaContainer, req: ShipRequest): Promise<ShipResult> {
  const locking = container.resolve(Modules.LOCKING) as {
    execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R>
  }
  return locking.execute([`medusify-ship:${req.orderId}`], () => shipLocked(container, req), {
    timeout: LOCK_WAIT_SECONDS,
    expire: LOCK_EXPIRE_SECONDS,
  })
}

async function shipLocked(container: MedusaContainer, req: ShipRequest): Promise<ShipResult> {
  let order = await readOrder(container, req.orderId)
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${req.orderId} not found`)
  if (order.status === "canceled") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "The order is canceled")

  const methodOptions = order.shipping_methods.map((m) => m.shipping_option_id).filter((x): x is string => !!x)
  const groups = groupsToFulfill(order, await profilesOf(container, methodOptions))
  const created = new Set<string>()
  for (const group of groups) {
    const { result } = await createOrderFulfillmentWorkflow(container).run({
      input: {
        order_id: order.id,
        items: group.items,
        location_id: locationFor(group, methodOptions, req.location_id),
        shipping_option_id: group.shipping_option_id,
        no_notification: !req.notify,
        created_by: req.userId,
      },
    })
    created.add((result as { id: string }).id)
  }
  if (created.size > 0) order = (await readOrder(container, req.orderId))!

  const open = order.fulfillments.filter(isOpen)
  const openShipping = open.filter((f) => f.requires_shipping !== false)
  const typed = req.tracking_number?.trim() || undefined
  // A typed number that a package of this order carries already (a repeat after a failure half way, or the carrier's own
  // number scanned from the label) stays where it is and goes on no second package.
  const holder = typed ? order.fulfillments.find((f) => !f.canceled_at && (f.labels ?? []).some((l) => l.tracking_number === typed)) : undefined
  const main = holder
    ? { target: isOpen(holder) && holder.requires_shipping !== false ? holder.id : undefined, ambiguous: false }
    : mainNumberTarget(
        openShipping.map((f) => f.id),
        created,
        req.numbers,
      )
  if (typed && main.ambiguous) {
    // Nothing is shipped: the packages exist now, and the app shows a field for each of them.
    throw new MedusaError(MedusaError.Types.INVALID_DATA, NUMBERS_REQUIRED)
  }
  // The tracking link belongs to the typed number, not to the numbers of other packages.
  const typedFor = (id: string): { number?: string; url?: string } =>
    req.numbers?.[id] ? { number: req.numbers[id] } : id === main.target ? { number: typed, url: req.tracking_url } : {}

  const result: ShipResult = {
    order_id: order.id,
    shipped: [],
    delivered: [],
    nothing_to_do: open.length === 0,
    unused_tracking_number: !!typed && !holder && !main.target,
  }
  for (const f of open) {
    if (f.requires_shipping === false) {
      // Nothing to send (a voucher, a download): Medusa's admin offers only "mark as delivered" for these.
      await markOrderFulfillmentAsDeliveredWorkflow(container).run({ input: { orderId: order.id, fulfillmentId: f.id, no_notification: !req.notify } as any })
      result.delivered.push(f.id)
      continue
    }
    const labels = labelsFor(f.labels, typedFor(f.id))
    const lineIds = [...new Set((f.items ?? []).map((i) => i.line_item_id))]
    await createOrderShipmentWorkflow(container).run({
      input: {
        order_id: order.id,
        fulfillment_id: f.id,
        // Medusa takes the quantities from the fulfillment itself (create-shipment `prepareRegisterShipmentData`); the
        // lines here are only checked to belong to the order.
        items: lineIds.map((id) => ({ id, quantity: (f.items ?? []).find((i) => i.line_item_id === id)!.quantity })),
        labels,
        no_notification: !req.notify,
        created_by: req.userId,
      },
    })
    result.shipped.push({ fulfillment_id: f.id, tracking_numbers: labels.map((l) => l.tracking_number) })
  }
  return result
}
