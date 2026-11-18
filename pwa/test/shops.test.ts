import { describe, expect, it } from "vitest"
import { defaultShopName, monogram, nextColor, normalizeShopUrl, removeShop, resolveScope, scopedShops, shopIdFromOrigin, upsertShop } from "../src/lib/shops"
import { shop } from "./fixtures"

describe("normalizeShopUrl", () => {
  it("adds https and keeps only the origin", () => {
    expect(normalizeShopUrl("Shop.Example.com/admin/orders?x=1")).toEqual({ ok: true, origin: "https://shop.example.com" })
  })
  it("rejects empty and malformed input", () => {
    expect(normalizeShopUrl("   ")).toEqual({ ok: false, reason: "empty" })
    expect(normalizeShopUrl("ftp://shop.example.com")).toEqual({ ok: false, reason: "invalid" })
    expect(normalizeShopUrl("https://")).toEqual({ ok: false, reason: "invalid" })
  })
  it("refuses plain http except on loopback", () => {
    expect(normalizeShopUrl("http://shop.example.com")).toEqual({ ok: false, reason: "insecure" })
    expect(normalizeShopUrl("http://localhost:9055")).toEqual({ ok: true, origin: "http://localhost:9055" })
    expect(normalizeShopUrl("http://dev.localhost:9055")).toEqual({ ok: true, origin: "http://dev.localhost:9055" })
    expect(normalizeShopUrl("http://127.0.0.1:9055")).toEqual({ ok: true, origin: "http://127.0.0.1:9055" })
  })
  it("refuses an IPv6 loopback literal, which the page's Content-Security-Policy cannot allow", () => {
    expect(normalizeShopUrl("http://[::1]:9055")).toEqual({ ok: false, reason: "insecure" })
  })
})

describe("shop list", () => {
  it("derives stable ids", () => {
    expect(shopIdFromOrigin("http://localhost:9055")).toBe("http://localhost:9055")
    expect(shopIdFromOrigin("https://Shop.Example.com")).toBe("https://shop.example.com")
  })
  it("hands out the first free colour and wraps", () => {
    expect(nextColor([{ color: 1 }, { color: 3 }])).toBe(2)
    expect(nextColor([1, 2, 3, 4, 5, 6].map((color) => ({ color }) as { color: 1 }))).toBe(1)
  })
  it("builds monogram and default name", () => {
    expect(monogram("  ärger")).toBe("Ä")
    expect(monogram("!!")).toBe("?")
    expect(defaultShopName("https://www.shop.example.com")).toBe("shop.example.com")
  })
  it("keeps the home shop first and replaces by id", () => {
    const list = upsertShop([shop("a", { home: true })], shop("b"))
    expect(list.map((s) => s.id)).toEqual(["a", "b"])
    expect(upsertShop(list, shop("b", { name: "B2" })).find((s) => s.id === "b")?.name).toBe("B2")
    expect(removeShop(list, "b").map((s) => s.id)).toEqual(["a"])
  })
  it("resolves scope to a shop that still exists", () => {
    const list = [shop("a"), shop("b")]
    expect(resolveScope(list, null)).toBe("all")
    expect(resolveScope(list, "b")).toBe("b")
    expect(resolveScope(list, "gone")).toBe("all")
    expect(scopedShops(list, "b").map((s) => s.id)).toEqual(["b"])
    expect(scopedShops(list, "all")).toHaveLength(2)
  })
})
