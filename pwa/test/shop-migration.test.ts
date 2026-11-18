import { beforeEach, describe, expect, it } from "vitest"
import { loadShopsMigrated } from "../src/lib/boot"
import { legacyShopId, shopIdFromOrigin } from "../src/lib/shops"
import { idbStore } from "../src/lib/store"
import type { Shop } from "../src/lib/types"

describe("shop ids", () => {
  it("different origins never share an id (a.b.com and a-b.com used to)", () => {
    const origins = ["https://a.b.com", "https://a-b.com", "http://localhost:9055", "https://localhost:9055", "http://localhost-9055", "https://shop.example.com:8443", "https://shop.example.com"]
    const ids = origins.map(shopIdFromOrigin)
    expect(new Set(ids).size).toBe(origins.length)
    // the old rule collided for these pairs
    expect(legacyShopId("https://a.b.com")).toBe(legacyShopId("https://a-b.com"))
    expect(legacyShopId("http://localhost:9055")).toBe(legacyShopId("https://localhost:9055"))
  })
  it("the id follows from the origin alone: case and default ports do not matter", () => {
    expect(shopIdFromOrigin("https://Shop.Example.com")).toBe(shopIdFromOrigin("https://shop.example.com"))
    expect(shopIdFromOrigin("https://shop.example.com:443")).toBe(shopIdFromOrigin("https://shop.example.com"))
  })
})

const stored = (id: string, url: string, over: Partial<Shop> = {}): Shop => ({ id, url, name: id, color: 1, home: false, ...over })

describe("shops saved by the previous version", () => {
  beforeEach(async () => {
    await idbStore.clear()
    localStorage.clear()
  })

  it("get the new id, keep token and push state, and the selected shop follows", async () => {
    const home = stored(legacyShopId("https://home.example.com"), "https://home.example.com", { home: true, pushRegistered: true })
    const other = stored(legacyShopId("https://b.example.com"), "https://b.example.com", { token: "jwt-b", pushRegistered: true, color: 2, name: "Shop B" })
    await idbStore.saveShops([home, other])
    localStorage.setItem("medusify.scope", other.id)

    const shops = await loadShopsMigrated(idbStore)

    expect(shops.map((s) => s.id)).toEqual([shopIdFromOrigin("https://home.example.com"), shopIdFromOrigin("https://b.example.com")])
    expect(shops[1]).toMatchObject({ token: "jwt-b", pushRegistered: true, color: 2, name: "Shop B", url: "https://b.example.com" })
    expect(shops[0]).toMatchObject({ home: true, pushRegistered: true })
    expect(localStorage.getItem("medusify.scope")).toBe(shopIdFromOrigin("https://b.example.com"))
    // written back once, so the next start does nothing
    expect((await idbStore.loadShops()).map((s) => s.id)).toEqual(shops.map((s) => s.id))
  })

  it("is idempotent", async () => {
    await idbStore.saveShops([stored(legacyShopId("https://b.example.com"), "https://b.example.com", { token: "t" })])
    const first = await loadShopsMigrated(idbStore)
    const second = await loadShopsMigrated(idbStore)
    expect(second).toEqual(first)
  })

  it("leaves the scope alone when it is 'all' or unknown, and survives an unreadable shop entry", async () => {
    await idbStore.saveShops([stored("junk", "not a url"), stored(legacyShopId("https://b.example.com"), "https://b.example.com")])
    localStorage.setItem("medusify.scope", "all")
    const shops = await loadShopsMigrated(idbStore)
    expect(shops.map((s) => s.id)).toEqual(["junk", shopIdFromOrigin("https://b.example.com")])
    expect(localStorage.getItem("medusify.scope")).toBe("all")
  })

  it("an empty store stays empty", async () => {
    expect(await loadShopsMigrated(idbStore)).toEqual([])
  })
})
