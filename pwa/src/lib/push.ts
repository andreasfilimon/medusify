import type { PushSubscriptionJson } from "./api"
import { SwTimeoutError } from "./sw"
import type { Shop } from "./types"

export type PushSupport = "unsupported" | "needs-install" | "denied" | "ask" | "granted"

export type PushEnv = {
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotification: boolean
  permission: NotificationPermission | "unavailable"
  /** iPhone/iPad Safari that is not running as an installed app: push cannot work there. */
  iosBrowserTab: boolean
}

export function pushSupport(env: PushEnv): PushSupport {
  if (env.iosBrowserTab) return "needs-install"
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported"
  if (env.permission === "denied") return "denied"
  if (env.permission === "granted") return "granted"
  return "ask"
}

export function readPushEnv(): PushEnv {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  return {
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    permission: "Notification" in window ? Notification.permission : "unavailable",
    iosBrowserTab: ios && !standalone,
  }
}

export interface PushApi {
  getVapidKey(shop: Shop): Promise<string>
  registerPush(shop: Shop, sub: PushSubscriptionJson): Promise<void>
  unregisterPush(shop: Shop, endpoint: string): Promise<void>
}

export interface PushRegistrationLike {
  pushManager: {
    getSubscription(): Promise<PushSubscriptionLike | null>
    subscribe(options: { userVisibleOnly: boolean; applicationServerKey: BufferSource }): Promise<PushSubscriptionLike>
  }
}
export interface PushSubscriptionLike {
  endpoint: string
  options?: { applicationServerKey?: ArrayBuffer | null }
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  unsubscribe(): Promise<boolean>
}

export type ShopPushResult = { shopId: string; ok: boolean; error?: string }
export type EnableResult =
  | { kind: "denied" }
  | { kind: "failed"; error: string }
  | { kind: "ok"; results: ShopPushResult[] }

export function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function toJson(sub: PushSubscriptionLike): PushSubscriptionJson {
  const j = sub.toJSON()
  if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) throw new Error("subscription is incomplete")
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth }, user_agent: navigator.userAgent.slice(0, 200) }
}

const same = (a: Uint8Array, b: ArrayBuffer | null | undefined) => {
  if (!b) return false
  const v = new Uint8Array(b)
  return v.length === a.length && v.every((x, i) => x === a[i])
}

/**
 * Subscribes this browser once, then registers that subscription at EVERY given shop.
 * A shop with a different VAPID key is reported as failed: it could never deliver to this subscription.
 */
export async function enablePush(
  shops: Shop[],
  deps: { api: PushApi; requestPermission(): Promise<NotificationPermission>; registration(): Promise<PushRegistrationLike> },
): Promise<EnableResult> {
  const permission = await deps.requestPermission()
  if (permission !== "granted") return { kind: "denied" }
  if (shops.length === 0) return { kind: "failed", error: "no shop" }
  let key: Uint8Array<ArrayBuffer>
  try {
    key = urlBase64ToBytes(await deps.api.getVapidKey(shops[0]!))
  } catch (e) {
    return { kind: "failed", error: (e as Error).message }
  }
  let json: PushSubscriptionJson
  try {
    const reg = await deps.registration()
    let sub = await reg.pushManager.getSubscription()
    if (sub && !same(key, sub.options?.applicationServerKey)) {
      await sub.unsubscribe()
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    json = toJson(sub)
  } catch (e) {
    return { kind: "failed", error: e instanceof SwTimeoutError ? "sw-timeout" : (e as Error).message }
  }
  const results = await Promise.all(shops.map((shop) => registerAt(shop, key, json, deps.api)))
  return { kind: "ok", results }
}

export async function registerAt(shop: Shop, key: Uint8Array, sub: PushSubscriptionJson, api: PushApi): Promise<ShopPushResult> {
  try {
    const shopKey = urlBase64ToBytes(await api.getVapidKey(shop))
    if (!same(key, shopKey.buffer)) return { shopId: shop.id, ok: false, error: "VAPID key differs" }
    await api.registerPush(shop, sub)
    return { shopId: shop.id, ok: true }
  } catch (e) {
    return { shopId: shop.id, ok: false, error: (e as Error).message || "failed" }
  }
}

/** Removes this device's subscription at the given shops. Returns the ids that could not be reached. */
export async function unregisterEverywhere(shops: Shop[], endpoint: string | null, api: PushApi): Promise<string[]> {
  if (!endpoint) return []
  const targets = shops.filter((s) => s.pushRegistered)
  const results = await Promise.allSettled(targets.map((s) => api.unregisterPush(s, endpoint)))
  return targets.filter((_, i) => results[i]!.status === "rejected").map((s) => s.id)
}
