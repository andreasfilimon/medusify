import { afterEach, describe, expect, it, vi } from "vitest"
import { acceptReturn, ApiError, cancelOrder, capturePayment, getPermissions, getPushPreferences, markDelivered, markPaid, refundPayment, setPushPreference } from "../src/lib/api"
import { ALL_ALLOWED } from "../src/lib/actions"
import { shop } from "./fixtures"

const home = shop("a", { home: true })

function answer(body: unknown = {}, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fn)
  return fn
}
const call = (fn: ReturnType<typeof answer>) => {
  const [url, init] = fn.mock.calls[0]!
  return { url: String(url).replace(/^https:\/\/a/, ""), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }
}

afterEach(() => vi.unstubAllGlobals())

describe("order action routes (proved in @medusajs/medusa 2.22.7)", () => {
  it("capture posts to the payment", async () => {
    const fn = answer()
    await capturePayment(home, "pay_1")
    expect(call(fn)).toMatchObject({ url: "/admin/payments/pay_1/capture", method: "POST" })
  })
  it("mark as paid sends the order id", async () => {
    const fn = answer()
    await markPaid(home, "pc_1", "order_1")
    expect(call(fn)).toMatchObject({ url: "/admin/payment-collections/pc_1/mark-as-paid", body: { order_id: "order_1" } })
  })
  it("cancel goes through the plugin, which asks for the refund right when money is refundable", async () => {
    const fn = answer()
    await cancelOrder(home, "order_1")
    expect(call(fn)).toMatchObject({ url: "/admin/medusify/orders/order_1/cancel", method: "POST" })
  })
  it("mark as delivered posts to the fulfillment", async () => {
    const fn = answer()
    await markDelivered(home, "order_1", "ful_1")
    expect(call(fn)).toMatchObject({ url: "/admin/orders/order_1/fulfillments/ful_1/mark-as-delivered", method: "POST" })
  })
  it("refund sends amount and the idempotency key, nothing else", async () => {
    const fn = answer()
    await refundPayment(home, "pay_1", 12.5, "key-1")
    expect(call(fn)).toMatchObject({ url: "/admin/payments/pay_1/refund", body: { amount: 12.5, idempotency_key: "key-1" } })
    expect(Object.keys(call(fn).body).sort()).toEqual(["amount", "idempotency_key"])
  })
  it("a return goes through the plugin route", async () => {
    const fn = answer({ return_id: "ret_1", refunded: true }, 201)
    expect(await acceptReturn(home, { order_id: "order_1", items: [{ id: "i1", quantity: 1 }], refund_amount: 5, idempotency_key: "key-12345" })).toEqual({ return_id: "ret_1", refunded: true })
    expect(call(fn)).toMatchObject({ url: "/admin/medusify/returns", body: { order_id: "order_1", refund_amount: 5, idempotency_key: "key-12345" } })
  })
  it("ids are escaped in the path", async () => {
    const fn = answer()
    await cancelOrder(home, "a/b")
    expect(call(fn).url).toBe("/admin/medusify/orders/a%2Fb/cancel")
  })
  it("a refusal from the shop reaches the caller", async () => {
    answer({ message: "no" }, 400)
    await expect(capturePayment(home, "pay_1")).rejects.toBeInstanceOf(ApiError)
  })
})

describe("permissions", () => {
  it("takes what the plugin says", async () => {
    answer({ actions: { ...ALL_ALLOWED, refund: false } })
    expect(await getPermissions(home)).toEqual({ ...ALL_ALLOWED, refund: false })
  })
  it("a shop without the route keeps every action visible", async () => {
    answer({ message: "not found" }, 404)
    expect(await getPermissions(home)).toEqual(ALL_ALLOWED)
  })
  it("a network failure does not hide anything either", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))))
    expect(await getPermissions(home)).toEqual(ALL_ALLOWED)
  })
  it("a rejected login is not swallowed", async () => {
    answer({ message: "unauthorized" }, 401)
    await expect(getPermissions(home)).rejects.toMatchObject({ kind: "unauthorized" })
  })
})

describe("push preferences", () => {
  it("reads and writes per device", async () => {
    const fn = answer({ kinds: { canceled: true, return_requested: false } })
    // a plugin older than 0.3.0 sends no threshold: -1 means "no low-stock row"
    expect(await getPushPreferences(home, "https://push.example.invalid/x")).toEqual({ kinds: { canceled: true, return_requested: false }, low_stock_threshold: -1 })
    expect(call(fn).url).toBe("/admin/medusify/push-preferences?endpoint=https%3A%2F%2Fpush.example.invalid%2Fx")
    const fn2 = answer({ kinds: { canceled: false, return_requested: false } })
    await setPushPreference(home, "https://push.example.invalid/x", "canceled", false)
    expect(call(fn2).body).toEqual({ endpoint: "https://push.example.invalid/x", kind: "canceled", enabled: false })
    answer({ kinds: { canceled: true, return_requested: false, low_stock: true }, low_stock_threshold: 3 })
    expect(await getPushPreferences(home, "https://push.example.invalid/x")).toEqual({ kinds: { canceled: true, return_requested: false, low_stock: true }, low_stock_threshold: 3 })
  })
})
