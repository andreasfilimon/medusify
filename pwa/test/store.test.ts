import { beforeEach, describe, expect, it } from "vitest"
import { idbStore } from "../src/lib/store"
import { shop } from "./fixtures"

describe("idbStore", () => {
  beforeEach(async () => {
    await idbStore.clear()
  })
  it("round-trips shops with their tokens", async () => {
    await idbStore.saveShops([shop("a", { home: true }), shop("b", { token: "jwt-b" })])
    const back = await idbStore.loadShops()
    expect(back.map((s) => s.id)).toEqual(["a", "b"])
    expect(back[1]?.token).toBe("jwt-b")
  })
  it("clear removes everything", async () => {
    await idbStore.saveShops([shop("b", { token: "jwt-b" })])
    await idbStore.clear()
    expect(await idbStore.loadShops()).toEqual([])
  })
  it("never writes credentials to localStorage", async () => {
    await idbStore.saveShops([shop("b", { token: "jwt-secret" })])
    expect(JSON.stringify({ ...localStorage })).not.toContain("jwt-secret")
  })
})
