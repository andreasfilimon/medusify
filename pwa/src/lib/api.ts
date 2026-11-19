import { ALL_ALLOWED, type Permissions } from "./actions"
import type { Dashboard, Order, OrderItem, Shop } from "./types"

export type ApiErrorKind = "unauthorized" | "notfound" | "rejected" | "network" | "server"

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly status = 0,
    message: string = kind,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * What a failed shipment call means for the user.
 * - unknown: no answer, a gateway/server error, or 409 (an earlier try with the same key is still in progress). The shop may have created the fulfillment or even the shipment
 *   before the connection broke, so "rejected" would be a guess.
 * - auth: the login ended.
 * - rejected: the shop answered and said no; its message (if any) is the reason.
 */
export type ShipFailure = { kind: "unknown" } | { kind: "auth" } | { kind: "rejected"; reason?: string }

export function shipFailure(err: unknown): ShipFailure {
  if (err instanceof ApiError) {
    if (err.kind === "network" || err.kind === "server") return { kind: "unknown" }
    // 409: the shop is still working on an earlier try with the same key (e.g. a refund in progress). It may still land.
    if (err.status === 409) return { kind: "unknown" }
    if (err.kind === "unauthorized") return { kind: "auth" }
    return { kind: "rejected", reason: err.message && err.message !== err.kind ? err.message : undefined }
  }
  return { kind: "unknown" }
}

type TokenSink = (shop: Shop, token: string) => void
let onToken: TokenSink = () => {}
/** The shop provider registers here so a refreshed bearer token reaches IndexedDB. */
export function setTokenSink(fn: TokenSink) {
  onToken = fn
}

function headers(shop: Shop, extra?: HeadersInit, json = false): Headers {
  const h = new Headers(extra)
  h.set("accept", "application/json")
  if (json) h.set("content-type", "application/json")
  if (!shop.home && shop.token) h.set("authorization", `Bearer ${shop.token}`)
  return h
}

/**
 * One fetch for every shop call. Never cached (cache: "no-store"), cookies only for the home origin,
 * a bearer token only for foreign shops. A 401 on a foreign shop tries one token refresh first.
 */
export async function shopFetch(shop: Shop, path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const json = init.body !== undefined
  let res: Response
  try {
    res = await fetch(shop.url + path, {
      ...init,
      headers: headers(shop, init.headers, json),
      cache: "no-store",
      credentials: shop.home ? "include" : "omit",
      redirect: "manual",
    })
  } catch {
    throw new ApiError("network")
  }
  if (res.type === "opaqueredirect") throw new ApiError("unauthorized", 302)
  if (res.status === 401 && !shop.home && shop.token && !retried) {
    const fresh = await refreshToken(shop)
    if (fresh) {
      onToken(shop, fresh)
      return shopFetch({ ...shop, token: fresh }, path, init, true)
    }
  }
  if (res.ok) return res
  if (res.status === 401) throw new ApiError("unauthorized", 401)
  if (res.status === 404) throw new ApiError("notfound", 404)
  let message = ""
  try {
    message = ((await res.clone().json()) as { message?: string }).message ?? ""
  } catch {
    /* body is not JSON */
  }
  throw new ApiError(res.status >= 500 ? "server" : "rejected", res.status, message)
}

async function refreshToken(shop: Shop): Promise<string | null> {
  try {
    const res = await fetch(`${shop.url}/auth/token/refresh`, {
      method: "POST",
      headers: headers(shop),
      cache: "no-store",
      credentials: "omit",
    })
    if (!res.ok) return null
    const body = (await res.json()) as { token?: string }
    return body.token ?? null
  } catch {
    return null
  }
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

// ---- probing a shop address (before any credentials) -------------------------------------------------------

export type ProbeResult =
  | { kind: "medusa" }
  | { kind: "unreachable" }
  | { kind: "cors" }
  | { kind: "preauth" }
  | { kind: "not-medusa" }

/** An unauthenticated admin route answers 401 with a JSON body on a Medusa backend. */
export async function probeShop(origin: string, fetchImpl: typeof fetch = fetch): Promise<ProbeResult> {
  const url = `${origin}/admin/users/me`
  try {
    const res = await fetchImpl(url, { cache: "no-store", credentials: "omit", redirect: "manual", headers: { accept: "application/json" } })
    if (res.type === "opaqueredirect") return { kind: "preauth" }
    if (res.status === 401) {
      try {
        await res.clone().json()
        return { kind: "medusa" }
      } catch {
        return { kind: "not-medusa" }
      }
    }
    if (res.status >= 300 && res.status < 400) return { kind: "preauth" }
    return { kind: "not-medusa" }
  } catch {
    // Browsers hide the reason. A no-cors request succeeds when the host is reachable but refuses our origin.
    try {
      await fetchImpl(url, { mode: "no-cors", cache: "no-store", credentials: "omit" })
      return { kind: "cors" }
    } catch {
      return { kind: "unreachable" }
    }
  }
}

// ---- authentication ---------------------------------------------------------------------------------------

export type LoginResult =
  | { kind: "ok"; token: string }
  | { kind: "mfa"; token: string; challengeId: string; methods: string[] }

const post = (shop: Shop, path: string, body?: unknown, extra?: HeadersInit) =>
  shopFetch(shop, path, { method: "POST", body: JSON.stringify(body ?? {}), headers: extra })

export async function login(shop: Shop, email: string, password: string): Promise<LoginResult> {
  const probe: Shop = { ...shop, home: false, token: undefined }
  const res = await post(probe, "/auth/user/emailpass", { email, password })
  const body = await json<{ token?: string; mfa_required?: boolean; mfa_challenge?: { id: string; methods?: string[] } }>(res)
  if (body.mfa_challenge && body.token) {
    return { kind: "mfa", token: body.token, challengeId: body.mfa_challenge.id, methods: body.mfa_challenge.methods ?? ["totp"] }
  }
  if (!body.token) throw new ApiError("rejected", res.status)
  return { kind: "ok", token: body.token }
}

export type LoginMethods = { password: boolean; google: boolean }

/**
 * Which sign-in methods the shop offers for admins. Medusa answers from `authMethodsPerActor`, so a shop that switched
 * off the password sees no form. Any failure falls back to the password form: it is what every Medusa shop has.
 */
export async function loginMethods(shop: Shop): Promise<LoginMethods> {
  try {
    const res = await shopFetch({ ...shop, home: false, token: undefined }, "/auth/user/providers")
    const body = await json<{ providers?: { id: string; flow?: string }[] }>(res)
    const list = body.providers ?? []
    const password = list.some((p) => p.id === "emailpass")
    const google = list.some((p) => p.id === "google" && p.flow === "redirect")
    return password || google ? { password, google } : { password: true, google: false }
  } catch {
    return { password: true, google: false }
  }
}

/** Step one of Google: the shop returns the address to send the browser to. The state inside it is checked on return. */
export async function googleStart(shop: Shop, callbackUrl: string): Promise<string> {
  const res = await post({ ...shop, home: false, token: undefined }, "/auth/user/google", { callback_url: callbackUrl })
  const body = await json<{ location?: string }>(res)
  if (!body.location) throw new ApiError("rejected", res.status)
  return body.location
}

/** Step two: the shop trades code and state for a token. Medusa applies no second factor to this path (measured, see SECURITY.md). */
export async function googleCallback(shop: Shop, code: string, state: string): Promise<LoginResult> {
  const probe: Shop = { ...shop, home: false, token: undefined }
  const res = await post(probe, `/auth/user/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`)
  const body = await json<{ token?: string; mfa_challenge?: { id: string; methods?: string[] } }>(res)
  if (!body.token) throw new ApiError("rejected", res.status)
  if (body.mfa_challenge) return { kind: "mfa", token: body.token, challengeId: body.mfa_challenge.id, methods: body.mfa_challenge.methods ?? ["totp"] }
  return { kind: "ok", token: body.token }
}

export async function verifyMfa(shop: Shop, challengeId: string, preToken: string, method: "totp" | "recovery_code", code: string): Promise<string> {
  const probe: Shop = { ...shop, home: false, token: preToken }
  const res = await post(probe, `/auth/mfa/challenges/${encodeURIComponent(challengeId)}/verify`, { method, code })
  const body = await json<{ token?: string }>(res)
  if (!body.token) throw new ApiError("rejected", res.status)
  return body.token
}

/** Home shop: turn the JWT into an httpOnly session cookie. The caller drops the JWT afterwards. */
export async function startSession(shop: Shop, token: string): Promise<void> {
  const res = await fetch(`${shop.url}/auth/session`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    cache: "no-store",
    credentials: "include",
  }).catch(() => {
    throw new ApiError("network")
  })
  if (!res.ok) throw new ApiError(res.status === 401 ? "unauthorized" : "rejected", res.status)
}

export async function endSession(shop: Shop): Promise<void> {
  await shopFetch(shop, "/auth/session", { method: "DELETE" })
}

export async function storeName(shop: Shop): Promise<string | null> {
  try {
    const res = await shopFetch(shop, "/admin/stores?fields=name&limit=1")
    const body = await json<{ stores?: { name?: string }[] }>(res)
    return body.stores?.[0]?.name?.trim() || null
  } catch {
    return null
  }
}

// ---- data -------------------------------------------------------------------------------------------------

export async function getDashboard(shop: Shop, timezone: string): Promise<Dashboard> {
  return json<Dashboard>(await shopFetch(shop, `/admin/medusify/dashboard?tz=${encodeURIComponent(timezone)}`))
}

export const ORDER_FIELDS = [
  "id", "display_id", "status", "created_at", "email", "currency_code", "payment_status", "fulfillment_status", "sales_channel_id",
  "total", "subtotal", "shipping_total", "tax_total", "item_total",
  "*items", "*items.detail", "*shipping_address", "*shipping_methods", "*fulfillments", "*fulfillments.items", "*fulfillments.labels",
  "*payment_collections", "*payment_collections.payments", "*payment_collections.payments.captures", "*payment_collections.payments.refunds",
  // `required_quantity` of an inventory kit: a fulfillment item of a kit line holds the line quantity times it (see shipmentsToCreate).
  "items.variant.inventory_items.inventory_item_id", "items.variant.inventory_items.required_quantity",
].join(",")

/** What the choice of the stock location depends on. The list (LIST_FIELDS) has none of the shipping data. */
const LOCATION_FIELDS = "id,sales_channel_id,*shipping_methods,*items,*items.detail,*fulfillments"

const LIST_FIELDS = "id,display_id,status,created_at,email,currency_code,payment_status,fulfillment_status,total,*shipping_address,*items"

export const PAGE_SIZE = 50

export type OrderScope = "active" | "canceled" | "any"
export type OrderQuery = { offset: number; q?: string; scope: OrderScope }

/** Query string for the order list. Medusa wants one `status[]` per value; a comma list ends up as one enum value (500). */
export function orderListParams(query: OrderQuery): URLSearchParams {
  const params = new URLSearchParams({ fields: LIST_FIELDS, order: "-created_at", limit: String(PAGE_SIZE), offset: String(query.offset) })
  if (query.q) params.set("q", query.q)
  // The server filters only by status; shipped/open is derived from fulfillment_status on the client (measured).
  const statuses = query.scope === "canceled" ? ["canceled"] : query.scope === "active" ? ["pending", "requires_action", "completed"] : []
  for (const status of statuses) params.append("status[]", status)
  return params
}

export async function listOrders(shop: Shop, query: OrderQuery): Promise<{ orders: Order[]; count: number }> {
  const body = await json<{ orders: Order[]; count: number }>(await shopFetch(shop, `/admin/orders?${orderListParams(query)}`))
  return { orders: body.orders, count: body.count }
}

export async function getOrder(shop: Shop, id: string): Promise<Order> {
  const body = await json<{ order: Order }>(await shopFetch(shop, `/admin/orders/${encodeURIComponent(id)}?fields=${ORDER_FIELDS}`))
  return body.order
}

export type ShipInput = { tracking_number: string; tracking_url?: string; notify: boolean; location_id?: string }

/**
 * Ships every line that is not yet shipped. Two Admin API calls, so Medusa fires its normal events:
 * create the fulfillment, then the shipment with the label (tracking number).
 * Safe to run again after a failure in between: the order is read fresh, and a fulfillment that
 * exists but is not shipped yet is reused instead of creating a second one.
 */
export async function shipOrder(shop: Shop, order: Order, input: ShipInput): Promise<void> {
  const id = encodeURIComponent(order.id)
  let current = await getOrder(shop, order.id)
  const toFulfill = remainingItems(current)
  if (toFulfill.length > 0) {
    const location = input.location_id ?? (await locationsOf(shop, current))[0]!.id
    await post(shop, `/admin/orders/${id}/fulfillments`, { items: toFulfill, location_id: location, no_notification: !input.notify })
    // The response does not list the new fulfillment reliably; read it back.
    current = await getOrder(shop, order.id)
  }
  const shipments = shipmentsToCreate(current)
  if (shipments.length === 0) throw new ApiError("rejected", 0, "nothing left to ship")
  for (const shipment of shipments) {
    await post(shop, `/admin/orders/${id}/fulfillments/${encodeURIComponent(shipment.fulfillment_id)}/shipments`, {
      items: shipment.items,
      labels: [{ tracking_number: input.tracking_number, tracking_url: input.tracking_url ?? "", label_url: "" }],
      no_notification: !input.notify,
    })
  }
}

type Shipment = { fulfillment_id: string; items: { id: string; quantity: number }[] }

/**
 * One shipment per open fulfillment, each with its own lines. Usually there is one (the one `shipOrder` just created, or
 * the one left by a failed try), and it takes every fulfilled line that is not shipped. A second one exists when
 * somebody packed part of the order in the Medusa admin: its lines must go out with their own fulfillment, otherwise it
 * stays open for good and the order never reads as shipped. Line quantities come from the order lines (fulfilled minus
 * shipped) and are cut to what each fulfillment holds; what no fulfillment accounts for goes with the newest one.
 *
 * What a fulfillment holds is counted in units of the order line, as Medusa does when it registers the shipment
 * (`create-shipment`, `prepareRegisterShipmentData`): the first fulfillment item of the line, divided by the
 * `required_quantity` of the variant's inventory item it belongs to (see `lineUnits`). An inventory kit has one
 * fulfillment item per inventory item, each with the line quantity times its `required_quantity`; they are not added up.
 */
export function shipmentsToCreate(order: Order): Shipment[] {
  const open = (order.fulfillments ?? []).filter(isOpenFulfillment)
  const unshipped = fulfilledUnshippedItems(order)
  if (open.length === 0 || unshipped.length === 0) return []
  if (open.length === 1) return [{ fulfillment_id: open[0]!.id, items: unshipped }]
  const lines = new Map((order.items ?? []).map((i) => [i.id, i]))
  const left = new Map(unshipped.map((i) => [i.id, i.quantity]))
  const shipments: Shipment[] = open.map((f) => {
    const held = new Map<string, number>()
    for (const item of f.items ?? []) if (!held.has(item.line_item_id)) held.set(item.line_item_id, lineUnits(order, lines.get(item.line_item_id), item))
    const items: Shipment["items"] = []
    for (const [lineId, quantity] of held) {
      const take = Math.min(quantity, left.get(lineId) ?? 0)
      if (take > 0) items.push({ id: lineId, quantity: take })
      left.set(lineId, (left.get(lineId) ?? 0) - take)
    }
    return { fulfillment_id: f.id, items }
  })
  const rest = [...left].filter(([, quantity]) => quantity > 0).map(([id, quantity]) => ({ id, quantity }))
  const last = shipments[shipments.length - 1]!
  last.items.push(...rest)
  return shipments.filter((x) => x.items.length > 0)
}

type FulfillmentItem = NonNullable<NonNullable<Order["fulfillments"]>[number]["items"]>[number]

/**
 * The quantity of an order line that one fulfillment item stands for: the item quantity divided by the `required_quantity`
 * of the variant's inventory item, as Medusa does.
 *
 * The variant data can be missing: with Medusa's role-based access an admin who may read orders but not inventory gets 200
 * and the linked `variant` fields are dropped from the answer (measured), and a deleted variant has none. Then the
 * ratio comes from the order itself: everything the line's open and shipped fulfillments hold of this inventory item,
 * divided by the line's fulfilled quantity (which is counted in line units). Without an inventory item, or with
 * nothing fulfilled, the item quantity is the line quantity.
 */
function lineUnits(order: Order, line: OrderItem | undefined, item: FulfillmentItem): number {
  const linked = item.inventory_item_id ? line?.variant?.inventory_items?.find((l) => l.inventory_item_id === item.inventory_item_id) : undefined
  const required = Number(linked?.required_quantity ?? 0)
  if (required > 0) return item.quantity / required
  const fulfilled = Number(line?.detail?.fulfilled_quantity ?? 0)
  if (!item.inventory_item_id || fulfilled <= 0) return item.quantity
  let held = 0
  for (const f of order.fulfillments ?? []) {
    if (f.canceled_at) continue
    for (const i of f.items ?? []) if (i.line_item_id === item.line_item_id && i.inventory_item_id === item.inventory_item_id) held += i.quantity
  }
  const ratio = held / fulfilled
  return ratio >= 1 ? item.quantity / ratio : item.quantity
}

/** Lines (and quantities) that are not yet fulfilled. */
export function remainingItems(order: Order): { id: string; quantity: number }[] {
  return (order.items ?? [])
    .map((i) => ({ id: i.id, quantity: i.quantity - Number(i.detail?.fulfilled_quantity ?? 0) }))
    .filter((i) => i.quantity > 0)
}

/** Lines (and quantities) that are fulfilled but not yet shipped. */
export function fulfilledUnshippedItems(order: Order): { id: string; quantity: number }[] {
  return (order.items ?? [])
    .map((i) => ({ id: i.id, quantity: Number(i.detail?.fulfilled_quantity ?? 0) - Number(i.detail?.shipped_quantity ?? 0) }))
    .filter((i) => i.quantity > 0)
}

export type FulfillmentLocation = { id: string; name: string }

const byNameThenId = (a: FulfillmentLocation, b: FulfillmentLocation) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/** A fulfillment that exists but has not been shipped or canceled: left over from an earlier try, or packed in the Medusa admin. */
function isOpenFulfillment(f: NonNullable<Order["fulfillments"]>[number]): boolean {
  return !f.shipped_at && !f.canceled_at
}

/**
 * The locations an order can be shipped from. A list with one entry needs no question; with several the form lets
 * the user choose, and without a choice `shipOrder` takes the first, which is the same one every time.
 *
 * The order is read here, whatever the caller holds: the order list carries neither the shipping methods nor the
 * sales channel, and with a list entry the choice would silently fall back to all stock locations and book at the
 * wrong one. One small read per opened form costs less than adding both to every page of the list, and a caller can
 * no longer pass an order that is too thin.
 */
export async function fulfillmentLocations(shop: Shop, order: Pick<Order, "id">): Promise<FulfillmentLocation[]> {
  const body = await json<{ order: Order }>(await shopFetch(shop, `/admin/orders/${encodeURIComponent(order.id)}?fields=${encodeURIComponent(LOCATION_FIELDS)}`))
  return locationsOf(shop, body.order)
}

/**
 * Same as `fulfillmentLocations` for an order that was read with the fields above (`shipOrder` has one).
 *
 * 0. Nothing is left to fulfill and a fulfillment is waiting for its shipment (a retry after a failure in between):
 *    `shipOrder` creates no fulfillment then, a choice would have no effect. The only entry is the location of that
 *    fulfillment (its name is not read, the form shows no choice for one entry).
 * 1. The location of the order's shipping option (shipping option, service zone, fulfillment set, location). The
 *    Medusa admin's "Create fulfillment" form starts with exactly this one (dashboard `order-create-fulfillment-form`).
 * 2. Otherwise the stock locations of the order's sales channel; if none is linked, all of them.
 * The list is sorted by name and id, so the answer does not depend on the order in which the API returns it.
 */
async function locationsOf(shop: Shop, order: Order): Promise<FulfillmentLocation[]> {
  if (remainingItems(order).length === 0) {
    const open = (order.fulfillments ?? []).find(isOpenFulfillment)
    if (open) return open.location_id ? [{ id: open.location_id, name: open.location_id }] : []
  }
  const optionId = order.shipping_methods?.[0]?.shipping_option_id
  if (optionId) {
    try {
      const fields = encodeURIComponent("+service_zone.fulfillment_set.location.id,+service_zone.fulfillment_set.location.name")
      const body = await json<{ shipping_option?: { service_zone?: { fulfillment_set?: { location?: { id?: string; name?: string } } } } }>(
        await shopFetch(shop, `/admin/shipping-options/${encodeURIComponent(optionId)}?fields=${fields}`),
      )
      const location = body.shipping_option?.service_zone?.fulfillment_set?.location
      if (location?.id) return [{ id: location.id, name: location.name ?? location.id }]
    } catch (e) {
      // The option may be gone or hidden from this user: fall through to the list. A lost connection is not that.
      if (!(e instanceof ApiError) || (e.kind !== "notfound" && e.kind !== "rejected")) throw e
    }
  }
  const list = async (salesChannelId?: string) => {
    const params = new URLSearchParams({ fields: "id,name", limit: "100" })
    if (salesChannelId) params.set("sales_channel_id", salesChannelId)
    const body = await json<{ stock_locations?: { id: string; name?: string }[] }>(await shopFetch(shop, `/admin/stock-locations?${params}`))
    return (body.stock_locations ?? []).map((l) => ({ id: l.id, name: l.name ?? l.id }))
  }
  let found = order.sales_channel_id ? await list(order.sales_channel_id) : []
  if (found.length === 0) found = await list()
  if (found.length === 0) throw new ApiError("rejected", 0, "no stock location")
  return found.sort(byNameThenId)
}

// ---- order actions ----------------------------------------------------------------------------------------
// Routes and bodies read from @medusajs/medusa 2.22.7 (dist/api/admin): payments/:id/capture {amount?}, payments/:id/refund
// {amount, note?, idempotency_key?}, payment-collections/:id/mark-as-paid {order_id}, orders/:id/cancel {} (the app uses the plugin's /admin/medusify/orders/:id/cancel),
// orders/:id/fulfillments/:fid/mark-as-delivered {}. The return goes through the plugin (/admin/medusify/returns).

export async function capturePayment(shop: Shop, paymentId: string): Promise<void> {
  await post(shop, `/admin/payments/${encodeURIComponent(paymentId)}/capture`)
}

export async function markPaid(shop: Shop, collectionId: string, orderId: string): Promise<void> {
  await post(shop, `/admin/payment-collections/${encodeURIComponent(collectionId)}/mark-as-paid`, { order_id: orderId })
}

/** Through the plugin: it is Medusa's cancel, plus the refund right when captured money is still to be given back. */
export async function cancelOrder(shop: Shop, orderId: string): Promise<void> {
  await post(shop, `/admin/medusify/orders/${encodeURIComponent(orderId)}/cancel`)
}

export async function markDelivered(shop: Shop, orderId: string, fulfillmentId: string): Promise<void> {
  await post(shop, `/admin/orders/${encodeURIComponent(orderId)}/fulfillments/${encodeURIComponent(fulfillmentId)}/mark-as-delivered`)
}

/** `idempotencyKey` is made once per opened refund sheet, so a retry after a lost answer cannot refund twice. */
export async function refundPayment(shop: Shop, paymentId: string, amount: number, idempotencyKey: string): Promise<void> {
  await post(shop, `/admin/payments/${encodeURIComponent(paymentId)}/refund`, { amount, idempotency_key: idempotencyKey })
}

/** `idempotency_key` is made once per attempt and sent again unchanged on a retry: the shop then answers with the same return. */
export type ReturnInput = { order_id: string; items: { id: string; quantity: number }[]; refund_amount?: number; idempotency_key?: string }

export async function acceptReturn(shop: Shop, input: ReturnInput): Promise<{ return_id: string; refunded: boolean }> {
  return json(await post(shop, "/admin/medusify/returns", input))
}

/**
 * What the signed-in user may do. A shop whose plugin is older than 0.2.0 has no such route (404) and a failed read says
 * nothing about the rights: both leave every action visible, and Medusa itself still refuses what the role may not do.
 */
export async function getPermissions(shop: Shop): Promise<Permissions> {
  try {
    const body = await json<{ actions?: Partial<Permissions> }>(await shopFetch(shop, "/admin/medusify/permissions"))
    return { ...ALL_ALLOWED, ...body.actions }
  } catch (e) {
    if (e instanceof ApiError && e.kind === "unauthorized") throw e
    return ALL_ALLOWED
  }
}

export type PushKindPrefs = Record<"canceled" | "return_requested", boolean>

export async function getPushPreferences(shop: Shop, endpoint: string): Promise<PushKindPrefs> {
  return (await json<{ kinds: PushKindPrefs }>(await shopFetch(shop, `/admin/medusify/push-preferences?endpoint=${encodeURIComponent(endpoint)}`))).kinds
}

export async function setPushPreference(shop: Shop, endpoint: string, kind: keyof PushKindPrefs, enabled: boolean): Promise<PushKindPrefs> {
  return (await json<{ kinds: PushKindPrefs }>(await post(shop, "/admin/medusify/push-preferences", { endpoint, kind, enabled }))).kinds
}

// ---- push (plugin routes) ---------------------------------------------------------------------------------

export async function getVapidKey(shop: Shop): Promise<string> {
  return (await json<{ public_key: string }>(await shopFetch(shop, "/admin/medusify/vapid-public-key"))).public_key
}

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string }; user_agent?: string }

export async function registerPush(shop: Shop, subscription: PushSubscriptionJson): Promise<void> {
  await post(shop, "/admin/medusify/push-subscriptions", subscription)
}

export async function unregisterPush(shop: Shop, endpoint: string): Promise<void> {
  await shopFetch(shop, "/admin/medusify/push-subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) })
}

export async function testPush(shop: Shop): Promise<{ sent: number; failed: number; removed: number }> {
  return json(await post(shop, "/admin/medusify/push-subscriptions/test"))
}
