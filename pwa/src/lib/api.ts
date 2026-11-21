import { ALL_ALLOWED, type Permissions } from "./actions"
import type { LookupMatch, ProductPage, ProductView } from "./catalog"
import type { CustomerDetail, CustomerPage } from "./customers"
import { sameDiscount, type Discount } from "./discounts"
import type { ManualOrderInput, OrderSetup } from "./manual-order"
import type { ChangeBody, ChangeMoney } from "./order-change"
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
export type ShipFailure = { kind: "unknown" } | { kind: "auth" } | { kind: "numbers" } | { kind: "rejected"; reason?: string }

/** The plugin's refusal when one typed number would fit several packages (plugin/src/lib/ship.ts, NUMBERS_REQUIRED). */
export const NUMBERS_REQUIRED = "medusify:numbers_required"

export function shipFailure(err: unknown): ShipFailure {
  if (err instanceof ApiError) {
    if (err.kind === "network" || err.kind === "server") return { kind: "unknown" }
    // 409: the shop is still working on an earlier try with the same key (e.g. a refund in progress). It may still land.
    if (err.status === 409) return { kind: "unknown" }
    if (err.kind === "unauthorized") return { kind: "auth" }
    if (err.message === NUMBERS_REQUIRED) return { kind: "numbers" }
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
  // A form (the photo upload) sets its own content type with the boundary.
  const json = init.body !== undefined && !(init.body instanceof FormData)
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
  if (res.status === 404) {
    // The plugin answers a missing product or customer with a medusify code; Medusa's 404 for an unknown route has none,
    // which is how a plugin too old for the route shows (catalogFailure, "old"). Only the code is kept.
    let code = ""
    try {
      const m = ((await res.clone().json()) as { message?: unknown }).message
      if (typeof m === "string" && m.startsWith("medusify:")) code = m
    } catch {
      /* body is not JSON */
    }
    throw new ApiError("notfound", 404, code || "notfound")
  }
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
  "id", "display_id", "status", "version", "created_at", "email", "customer_id", "currency_code", "payment_status", "fulfillment_status", "sales_channel_id",
  "total", "subtotal", "shipping_total", "tax_total", "item_total",
  "*items", "*items.detail", "*shipping_address", "*shipping_methods", "*fulfillments", "*fulfillments.items", "*fulfillments.labels",
  "*payment_collections", "*payment_collections.payments", "*payment_collections.payments.captures", "*payment_collections.payments.refunds",
  // `required_quantity` of an inventory kit: a fulfillment item of a kit line holds the line quantity times it (see shipmentsToCreate).
  "items.variant.inventory_items.inventory_item_id", "items.variant.inventory_items.required_quantity",
].join(",")

/** What the choice of the stock location depends on. The list (LIST_FIELDS) has none of the shipping data. */
const LOCATION_FIELDS = "id,sales_channel_id,*shipping_methods,*items,*items.detail,*fulfillments"

/** The location fields and the labels of the fulfillments, for the ship form (`shipPlan`). */
const PLAN_FIELDS = `${LOCATION_FIELDS},*fulfillments.labels`

// The line details decide whether goods are left to send (orders.ts, unsentRest); Medusa's status alone hides them.
const LIST_FIELDS = "id,display_id,status,created_at,email,currency_code,payment_status,fulfillment_status,total,*shipping_address,*items,*items.detail"

export const PAGE_SIZE = 50

export type OrderScope = "active" | "canceled" | "any"
export type OrderQuery = { offset: number; q?: string; scope: OrderScope; customerId?: string }

/** Query string for the order list. Medusa wants one `status[]` per value; a comma list ends up as one enum value (500). */
export function orderListParams(query: OrderQuery): URLSearchParams {
  const params = new URLSearchParams({ fields: LIST_FIELDS, order: "-created_at", limit: String(PAGE_SIZE), offset: String(query.offset) })
  if (query.q) params.set("q", query.q)
  if (query.customerId) params.set("customer_id", query.customerId)
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

export type ShipInput = {
  /** The number of the package packed now, or of the only package that is packed already. Optional: a carrier integration may set its own. */
  tracking_number?: string
  tracking_url?: string
  notify: boolean
  location_id?: string
  /** Numbers for packages that were packed before (in the Medusa admin or by an earlier try), by fulfillment id. */
  numbers?: Record<string, string>
}

/** How long the app waits for the ship call. iOS freezes a PWA in the background; a call without an end held the form busy for good. */
export const SHIP_TIMEOUT_MS = 45_000

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined") return undefined
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms)
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/**
 * Ships every line that is not yet shipped, in one request to the plugin (`POST /admin/medusify/orders/:id/ship`): the
 * plugin creates the missing fulfillments and registers every shipment on the server, under one lock per order, and a
 * repeat finds the work done. Before, the app made Medusa's two calls itself, and when iOS put the app away between them
 * the order stayed packed but not shipped, without the customer's mail (live shop, 2026-11-19).
 *
 * A shop whose plugin is older has no such route (404); then the app makes Medusa's calls itself (`shipStepByStep`).
 */
/** What the ship call did that the user should hear about: a typed number that went on no package. */
export type ShipOutcome = { unusedNumber: boolean }

export async function shipOrder(shop: Shop, order: Order, input: ShipInput): Promise<ShipOutcome> {
  const numbers = Object.fromEntries(Object.entries(input.numbers ?? {}).map(([k, v]) => [k, cleanNumber(v)]).filter(([, v]) => v))
  const body = {
    notify: input.notify,
    location_id: input.location_id,
    tracking_number: cleanNumber(input.tracking_number) || undefined,
    tracking_url: input.tracking_url?.trim() || undefined,
    numbers: Object.keys(numbers).length ? numbers : undefined,
  }
  try {
    const res = await shopFetch(shop, `/admin/medusify/orders/${encodeURIComponent(order.id)}/ship`, { method: "POST", body: JSON.stringify(body), signal: timeoutSignal(SHIP_TIMEOUT_MS) })
    const result = await json<{ unused_tracking_number?: boolean }>(res).catch(() => ({}) as { unused_tracking_number?: boolean })
    return { unusedNumber: result.unused_tracking_number === true }
  } catch (e) {
    // Only "no such route" leads to the old way; every other answer is the answer (an unknown order fails there again).
    if (!(e instanceof ApiError && e.kind === "notfound")) throw e
  }
  return shipStepByStep(shop, order, { ...input, numbers })
}

const cleanNumber = (s: string | undefined) => (s ?? "").trim()

type Label = { tracking_number: string; tracking_url: string; label_url: string }
type LabelIn = { tracking_number?: string | null; tracking_url?: string | null; label_url?: string | null }

const httpOrEmpty = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : "")

/**
 * The labels a fulfillment carries after its shipment (same rule as the plugin's `labelsFor`). Medusa replaces the
 * labels with the list in the shipment call, so the labels a carrier integration wrote when the fulfillment was created
 * go in again (measured: no list leaves none, a typed number leaves only that one). A typed number is added unless it is
 * one of them. Medusa takes only http(s) URLs or "", and a carrier may store a relative path, so other values become "".
 */
export function labelsFor(existing: readonly LabelIn[] | undefined, typed?: { number?: string; url?: string }): Label[] {
  const labels: Label[] = (existing ?? [])
    .filter((l) => l.tracking_number)
    .map((l) => ({ tracking_number: l.tracking_number!, tracking_url: httpOrEmpty(l.tracking_url), label_url: httpOrEmpty(l.label_url) }))
  const number = typed?.number?.trim()
  if (number && !labels.some((l) => l.tracking_number === number)) labels.push({ tracking_number: number, tracking_url: httpOrEmpty(typed?.url), label_url: "" })
  return labels
}

/**
 * Which package the typed number belongs to (same rule as the plugin's `mainNumberTarget`): the one packed now, or with
 * nothing packed now the only one waiting; packages with a number of their own do not count. With several candidates the
 * number fits none for sure, and the user is asked for one number per package.
 */
export function mainNumberTarget(open: readonly string[], created: ReadonlySet<string>, numbers: Readonly<Record<string, string>> | undefined): { target?: string; ambiguous: boolean } {
  const packedNow = open.filter((id) => created.has(id))
  const pool = packedNow.length > 0 ? packedNow : [...open]
  const candidates = pool.filter((id) => !numbers?.[id])
  if (candidates.length === 1) return { target: candidates[0], ambiguous: false }
  return { ambiguous: candidates.length > 1 }
}

/**
 * The old way, for a plugin without the ship route: Medusa's two Admin API calls, create the fulfillment, then the
 * shipment of every open fulfillment. Safe to run again: the order is read fresh, an open fulfillment is reused, and an
 * order with nothing left to ship counts as done (a repeat after a lost answer).
 */
async function shipStepByStep(shop: Shop, order: Order, input: ShipInput): Promise<ShipOutcome> {
  const id = encodeURIComponent(order.id)
  let current = await getOrder(shop, order.id)
  const before = new Set((current.fulfillments ?? []).map((f) => f.id))
  const toFulfill = remainingItems(current)
  if (toFulfill.length > 0) {
    const location = input.location_id ?? (await locationsOf(shop, current))[0]!.id
    await post(shop, `/admin/orders/${id}/fulfillments`, { items: toFulfill, location_id: location, no_notification: !input.notify })
    // The response does not list the new fulfillment reliably; read it back.
    current = await getOrder(shop, order.id)
  }
  const created = new Set((current.fulfillments ?? []).map((f) => f.id).filter((f) => !before.has(f)))
  const shipments = shipmentsToCreate(current)
  const byId = new Map((current.fulfillments ?? []).map((f) => [f.id, f]))
  const typedMain = input.tracking_number?.trim() || undefined
  // Same rules as the plugin: a number a package carries already stays there, the link goes with the typed number only.
  const holder = typedMain ? (current.fulfillments ?? []).find((f) => !f.canceled_at && (f.labels ?? []).some((l) => l.tracking_number === typedMain)) : undefined
  const main = holder
    ? { target: shipments.some((x) => x.fulfillment_id === holder.id) ? holder.id : undefined, ambiguous: false }
    : mainNumberTarget(shipments.map((x) => x.fulfillment_id), created, input.numbers)
  if (typedMain && main.ambiguous) throw new ApiError("rejected", 400, NUMBERS_REQUIRED)
  for (const shipment of shipments) {
    const own = input.numbers?.[shipment.fulfillment_id]
    const typed = own ? { number: own } : shipment.fulfillment_id === main.target ? { number: typedMain, url: input.tracking_url } : {}
    await post(shop, `/admin/orders/${id}/fulfillments/${encodeURIComponent(shipment.fulfillment_id)}/shipments`, {
      items: shipment.items,
      labels: labelsFor(byId.get(shipment.fulfillment_id)?.labels, typed),
      no_notification: !input.notify,
    })
  }
  return { unusedNumber: !!typedMain && !holder && !main.target }
}

/** A package that is packed but not shipped, as the ship form shows it. */
export type OpenPackage = { id: string; labels: string[] }

export type ShipPlan = {
  locations: FulfillmentLocation[]
  /** True when lines are left to pack: the ship call packs them into a new package, and the main number belongs to it. */
  packsNew: boolean
  /** Packages packed earlier that still wait for their shipment (only goods to ship; a voucher has no parcel). */
  packages: OpenPackage[]
}

/**
 * What the ship form needs to know, from one read of the order: where the goods leave from, whether a new package is
 * packed, and the packages packed earlier with the numbers a carrier integration gave them.
 */
export async function shipPlan(shop: Shop, order: Pick<Order, "id">): Promise<ShipPlan> {
  const body = await json<{ order: Order }>(await shopFetch(shop, `/admin/orders/${encodeURIComponent(order.id)}?fields=${encodeURIComponent(PLAN_FIELDS)}`))
  const o = body.order
  const packages = (o.fulfillments ?? [])
    .filter((f) => !f.shipped_at && !f.canceled_at && !f.delivered_at && f.requires_shipping !== false)
    .map((f) => ({ id: f.id, labels: (f.labels ?? []).map((l) => l.tracking_number ?? "").filter(Boolean) }))
  // Only goods to ship make a new parcel; a voucher left to fulfill does not (it is marked as delivered).
  const shipping = new Set((o.items ?? []).filter((i) => i.requires_shipping !== false).map((i) => i.id))
  const packsNew = remainingItems(o).some((r) => shipping.has(r.id))
  return { locations: await locationsOf(shop, o), packsNew, packages }
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

export type PushKindPrefs = Record<"canceled" | "return_requested" | "low_stock", boolean>

/** What a device gets: which optional kinds are on, and from how many units on the low-stock message comes (plugin 0.3.0). */
export type PushPrefs = { kinds: PushKindPrefs; low_stock_threshold: number }

type PrefsAnswer = { kinds: Partial<PushKindPrefs>; low_stock_threshold?: number }

/** A plugin older than 0.3.0 answers without the low-stock kind and the threshold: those rows are left out of the screen. */
const toPrefs = (body: PrefsAnswer): PushPrefs => ({
  kinds: { canceled: true, return_requested: true, ...body.kinds } as PushKindPrefs,
  low_stock_threshold: body.low_stock_threshold ?? -1,
})

export async function getPushPreferences(shop: Shop, endpoint: string): Promise<PushPrefs> {
  return toPrefs(await json<PrefsAnswer>(await shopFetch(shop, `/admin/medusify/push-preferences?endpoint=${encodeURIComponent(endpoint)}`)))
}

export async function setPushPreference(shop: Shop, endpoint: string, kind: keyof PushKindPrefs, enabled: boolean): Promise<PushPrefs> {
  return toPrefs(await json<PrefsAnswer>(await post(shop, "/admin/medusify/push-preferences", { endpoint, kind, enabled })))
}

export async function setLowStockThreshold(shop: Shop, endpoint: string, threshold: number): Promise<PushPrefs> {
  return toPrefs(await json<PrefsAnswer>(await post(shop, "/admin/medusify/push-preferences", { endpoint, low_stock_threshold: threshold })))
}

// ---- catalog and stock (plugin 0.3.0) -----------------------------------------------------------------------

export const PRODUCT_PAGE = 30

/** Refusals of the plugin's catalog routes that the app words itself (plugin/src/workflows/change-stock.ts, quick-create-product.ts). */
export const BELOW_ZERO = "medusify:below_zero"
export const NOTHING_TO_UNDO = "medusify:nothing_to_undo"
export const AMOUNT_DECIMALS = "medusify:amount_decimals"
export const CURRENCY_NOT_SUPPORTED = "medusify:currency_not_supported"
export const NO_LOCATION = "medusify:no_location"

/** What a failed catalog call means for the user. `unknown`: no answer or a server error; for a stock change the same key may be sent again. */
export type CatalogFailure = { kind: "unknown" } | { kind: "auth" } | { kind: "forbidden" } | { kind: "old" } | { kind: "rejected"; code?: string; reason?: string }

export function catalogFailure(err: unknown): CatalogFailure {
  if (err instanceof ApiError) {
    if (err.kind === "network" || err.kind === "server") return { kind: "unknown" }
    if (err.status === 409) return { kind: "unknown" }
    if (err.kind === "unauthorized") return { kind: "auth" }
    if (err.status === 403) return { kind: "forbidden" }
    // A plugin older than 0.3.0 has no such route: Medusa answers 404 without a medusify code.
    if (err.kind === "notfound" && !err.message.startsWith("medusify:")) return { kind: "old" }
    if (err.message.startsWith("medusify:")) return { kind: "rejected", code: err.message }
    return { kind: "rejected", reason: err.message && err.message !== err.kind ? err.message : undefined }
  }
  return { kind: "unknown" }
}

export async function listProducts(shop: Shop, query: { q?: string; offset?: number; limit?: number }): Promise<ProductPage> {
  const p = new URLSearchParams({ offset: String(query.offset ?? 0), limit: String(query.limit ?? PRODUCT_PAGE) })
  if (query.q) p.set("q", query.q)
  return json<ProductPage>(await shopFetch(shop, `/admin/medusify/products?${p}`))
}

export async function getProduct(shop: Shop, id: string): Promise<ProductView> {
  return (await json<{ product: ProductView }>(await shopFetch(shop, `/admin/medusify/products/${encodeURIComponent(id)}`))).product
}

export async function lookupVariants(shop: Shop, code: string): Promise<LookupMatch[]> {
  return (await json<{ matches: LookupMatch[] }>(await shopFetch(shop, `/admin/medusify/variants/lookup?code=${encodeURIComponent(code)}`))).matches
}

export type StockRequest =
  | { mode: "adjust" | "set"; inventory_item_id: string; location_id: string; quantity: number; idempotency_key: string }
  | { mode: "undo"; undo_of: string; idempotency_key: string }

export type StockAnswer = { inventory_item_id: string; location_id: string; stocked: number; reserved: number; available: number; replayed: boolean; delta: number }

/** One stock change. The key makes it safe to send again after a lost answer: the shop answers a repeat without writing. */
export async function changeStock(shop: Shop, req: StockRequest): Promise<StockAnswer> {
  return json<StockAnswer>(await post(shop, "/admin/medusify/inventory", req))
}

export async function setBasePrice(shop: Shop, variantId: string, currency: string, amount: number): Promise<ProductView["variants"][number]["prices"]> {
  return (await json<{ prices: ProductView["variants"][number]["prices"] }>(await post(shop, `/admin/medusify/variants/${encodeURIComponent(variantId)}/price`, { currency_code: currency, amount }))).prices
}

/** Draft or published: Medusa's own product update. */
export async function setProductStatus(shop: Shop, productId: string, status: "draft" | "published"): Promise<void> {
  await post(shop, `/admin/products/${encodeURIComponent(productId)}`, { status })
}

/** Writes a barcode onto a variant: Medusa's own variant update. */
export async function setVariantBarcode(shop: Shop, productId: string, variantId: string, barcode: string): Promise<void> {
  await post(shop, `/admin/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`, { barcode })
}

export type NewProduct = { title: string; status: "draft" | "published"; price: { currency_code: string; amount: number }; stock: { location_id: string; quantity: number }; image_url?: string; idempotency_key: string }

export async function createProduct(shop: Shop, input: NewProduct): Promise<{ product_id: string; variant_id: string; replayed: boolean }> {
  return json(await post(shop, "/admin/medusify/products", input))
}

/** Uploads the photo through Medusa's file module and returns its address. */
export async function uploadPhoto(shop: Shop, photo: Blob): Promise<string> {
  const form = new FormData()
  form.append("files", photo, "photo.jpg")
  const body = await json<{ files?: { url?: string }[] }>(await shopFetch(shop, "/admin/uploads", { method: "POST", body: form }))
  const url = body.files?.[0]?.url
  if (!url) throw new ApiError("rejected", 200, "no url")
  return url
}

export type StockLocation = { id: string; name: string }

/** The shop's stock locations; empty when the user may not list them (the screens then use the locations of the product). */
export async function stockLocations(shop: Shop): Promise<StockLocation[]> {
  try {
    const body = await json<{ stock_locations?: { id: string; name?: string }[] }>(await shopFetch(shop, "/admin/stock-locations?limit=100&fields=id,name"))
    return (body.stock_locations ?? []).map((l) => ({ id: l.id, name: l.name ?? l.id }))
  } catch (e) {
    if (e instanceof ApiError && e.kind === "unauthorized") throw e
    return []
  }
}

/** The currencies the shop sells in, default first; empty when the shop's settings cannot be read. */
export async function storeCurrencies(shop: Shop): Promise<string[]> {
  try {
    const body = await json<{ stores?: { supported_currencies?: { currency_code: string; is_default?: boolean }[] }[] }>(await shopFetch(shop, "/admin/stores?fields=id,*supported_currencies"))
    const list = body.stores?.[0]?.supported_currencies ?? []
    return [...list].sort((a, b) => Number(!!b.is_default) - Number(!!a.is_default)).map((c) => c.currency_code.toLowerCase())
  } catch (e) {
    if (e instanceof ApiError && e.kind === "unauthorized") throw e
    return []
  }
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

// ---- Customers (Stufe 3) ----

export const CUSTOMER_PAGE = 30

export async function listCustomers(shop: Shop, query: { q?: string; offset?: number; limit?: number }): Promise<CustomerPage> {
  const p = new URLSearchParams({ offset: String(query.offset ?? 0), limit: String(query.limit ?? CUSTOMER_PAGE) })
  if (query.q) p.set("q", query.q)
  return json<CustomerPage>(await shopFetch(shop, `/admin/medusify/customers?${p}`))
}

export async function getCustomer(shop: Shop, id: string): Promise<CustomerDetail> {
  return (await json<{ customer: CustomerDetail }>(await shopFetch(shop, `/admin/medusify/customers/${encodeURIComponent(id)}`))).customer
}

// ---- Discount codes (Stufe 3): Medusa's own promotion routes ----

const DISCOUNT_FIELDS = "id,code,status,is_automatic,limit,used,created_at,application_method.type,application_method.value,application_method.currency_code,application_method.target_type"
export const DISCOUNT_PAGE = 50

export async function listDiscounts(shop: Shop, query: { q?: string; offset?: number }): Promise<{ promotions: Discount[]; count: number; offset: number }> {
  const p = new URLSearchParams({ fields: DISCOUNT_FIELDS, limit: String(DISCOUNT_PAGE), offset: String(query.offset ?? 0), order: "-created_at" })
  if (query.q) p.set("q", query.q)
  const body = await json<{ promotions: Discount[]; count: number; offset?: number }>(await shopFetch(shop, `/admin/promotions?${p}`))
  return { promotions: body.promotions, count: body.count, offset: body.offset ?? query.offset ?? 0 }
}

async function discountByCode(shop: Shop, code: string): Promise<Discount | null> {
  const p = new URLSearchParams({ fields: DISCOUNT_FIELDS, code, limit: "1" })
  const body = await json<{ promotions: Discount[] }>(await shopFetch(shop, `/admin/promotions?${p}`))
  return body.promotions.find((d) => d.code === code) ?? null
}

export type NewDiscount = { code: string; type: "percentage" | "fixed"; value: number; currency_code: string | null; limit: number | null }

/**
 * A code for the whole order, active at once. Medusa keeps codes unique, so a second tap or a retry after a lost answer
 * cannot make a second code: it is refused, and the app then looks the code up — the same code with the same discount
 * is the one this request made.
 */
export async function createDiscount(shop: Shop, input: NewDiscount): Promise<Discount> {
  const body = {
    code: input.code,
    type: "standard",
    status: "active",
    is_automatic: false,
    limit: input.limit,
    application_method: {
      type: input.type,
      target_type: "order",
      allocation: "across",
      value: input.value,
      ...(input.type === "fixed" ? { currency_code: input.currency_code } : {}),
    },
  }
  try {
    return (await json<{ promotion: Discount }>(await post(shop, "/admin/promotions", body))).promotion
  } catch (e) {
    if (e instanceof ApiError && e.kind === "unauthorized") throw e
    const found = await discountByCode(shop, input.code).catch(() => null)
    if (found && sameDiscount(found, input)) return found
    if (found) throw new ApiError("rejected", 400, DISCOUNT_CODE_TAKEN)
    throw e
  }
}

export const DISCOUNT_CODE_TAKEN = "medusify:code_taken"

export async function setDiscountStatus(shop: Shop, id: string, status: "active" | "inactive"): Promise<void> {
  await post(shop, `/admin/promotions/${encodeURIComponent(id)}`, { status })
}

/** Regions and flat shipping options with their price per region, for an order taken by hand (plugin 0.4.0). */
export async function orderSetup(shop: Shop): Promise<OrderSetup> {
  return json<OrderSetup>(await shopFetch(shop, "/admin/medusify/orders/setup"))
}

/**
 * An order taken by hand. The key makes a repeat the same order: the plugin answers a known key with the order it made
 * (`replayed`), so a lost answer is retried with the same key and never makes a second order.
 */
/**
 * `incomplete`: a repeat found the order of a first try that stopped half-way (made, not yet marked paid); it is not made
 * again, the merchant finishes it on the order.
 */
export async function createManualOrder(shop: Shop, input: ManualOrderInput): Promise<{ order_id: string; display_id: number | null; replayed: boolean; incomplete?: boolean }> {
  return json(await post(shop, "/admin/medusify/orders", input))
}

export type ManualOrderAttempt = { state: "none" } | { state: "done" | "incomplete"; order_id: string; display_id: number | null }

/** What the order by hand sent with this key came to; the app asks after a lost answer (plugin 0.4.0). */
export async function manualOrderAttempt(shop: Shop, key: string): Promise<ManualOrderAttempt> {
  return json(await shopFetch(shop, `/admin/medusify/orders/attempts/${encodeURIComponent(key)}`))
}

/** What a change would do to the money; nothing stays changed in the shop (plugin 0.4.0). */
export async function previewChange(shop: Shop, orderId: string, change: ChangeBody): Promise<ChangeMoney> {
  return json(await post(shop, `/admin/medusify/orders/${encodeURIComponent(orderId)}/change/preview`, { change }))
}

/**
 * Makes the change the merchant confirmed with this difference. Another difference now is refused
 * (`medusify:difference_changed`) and changes nothing; a repeat of the key answers from the first result.
 */
export async function applyChange(shop: Shop, orderId: string, change: ChangeBody, expected: number, key: string): Promise<ChangeMoney & { replayed: boolean }> {
  return json(await post(shop, `/admin/medusify/orders/${encodeURIComponent(orderId)}/change`, { change, expected_difference: expected, idempotency_key: key }))
}
