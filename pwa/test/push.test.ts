import { describe, expect, it, vi } from "vitest"
import { enablePush, pushSupport, unregisterEverywhere, type PushApi, type PushRegistrationLike, type PushSubscriptionLike } from "../src/lib/push"
import { shop } from "./fixtures"

// 65-byte uncompressed P-256 point, base64url. The content is irrelevant, only equality counts.
const KEY = "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0BB"

const subscription = (endpoint = "https://push.example/1"): PushSubscriptionLike => ({
  endpoint,
  options: { applicationServerKey: null },
  toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
  unsubscribe: async () => true,
})
const registration = (sub = subscription()): PushRegistrationLike => ({
  pushManager: { getSubscription: async () => null, subscribe: vi.fn(async () => sub) },
})
const api = (over: Partial<PushApi> = {}): PushApi => ({
  getVapidKey: vi.fn(async () => KEY),
  registerPush: vi.fn(async () => undefined),
  unregisterPush: vi.fn(async () => undefined),
  ...over,
})

describe("pushSupport", () => {
  const env = { hasServiceWorker: true, hasPushManager: true, hasNotification: true, permission: "default" as const, iosBrowserTab: false }
  it("asks only when nothing blocks it", () => expect(pushSupport(env)).toBe("ask"))
  it("an iPhone browser tab needs the installed app", () => expect(pushSupport({ ...env, iosBrowserTab: true })).toBe("needs-install"))
  it("respects a denied permission", () => expect(pushSupport({ ...env, permission: "denied" })).toBe("denied"))
  it("reports missing APIs", () => expect(pushSupport({ ...env, hasPushManager: false })).toBe("unsupported"))
})

describe("enablePush", () => {
  it("registers the device at every signed-in shop", async () => {
    const a = api()
    const shops = [shop("a", { home: true }), shop("b", { token: "t" }), shop("c", { token: "t" })]
    const res = await enablePush(shops, { api: a, requestPermission: async () => "granted", registration: async () => registration() })
    expect(res.kind).toBe("ok")
    expect(vi.mocked(a.registerPush).mock.calls.map(([s]) => s.id)).toEqual(["a", "b", "c"])
  })
  it("one shop failing does not stop the others", async () => {
    const a = api({
      registerPush: vi.fn(async (s) => {
        if (s.id === "b") throw new Error("503")
      }),
    })
    const res = await enablePush([shop("a"), shop("b"), shop("c")], { api: a, requestPermission: async () => "granted", registration: async () => registration() })
    expect(res.kind === "ok" && res.results.map((r) => [r.shopId, r.ok])).toEqual([["a", true], ["b", false], ["c", true]])
  })
  it("refuses a shop whose VAPID key differs", async () => {
    const other = "BP8AAQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4"
    const a = api({ getVapidKey: vi.fn(async (s) => (s.id === "b" ? other : KEY)) })
    const res = await enablePush([shop("a"), shop("b")], { api: a, requestPermission: async () => "granted", registration: async () => registration() })
    expect(res.kind === "ok" && res.results.find((r) => r.shopId === "b")?.ok).toBe(false)
    expect(vi.mocked(a.registerPush).mock.calls.map(([s]) => s.id)).toEqual(["a"])
  })
  it("does not subscribe when the permission is denied", async () => {
    const reg = registration()
    const res = await enablePush([shop("a")], { api: api(), requestPermission: async () => "denied", registration: async () => reg })
    expect(res.kind).toBe("denied")
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
  })
})

describe("unregisterEverywhere", () => {
  it("removes at every registered shop and names the ones it could not reach", async () => {
    const a = api({
      unregisterPush: vi.fn(async (s) => {
        if (s.id === "b") throw new Error("offline")
      }),
    })
    const shops = [shop("a", { pushRegistered: true }), shop("b", { pushRegistered: true }), shop("c")]
    expect(await unregisterEverywhere(shops, "https://push.example/1", a)).toEqual(["b"])
    expect(vi.mocked(a.unregisterPush).mock.calls.map(([s]) => s.id)).toEqual(["a", "b"])
  })
})
