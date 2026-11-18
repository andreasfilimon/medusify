import { describe, expect, it, vi } from "vitest"
import { logoutAll, removeForeignShop, type SessionDeps } from "../src/lib/session"
import { idbStore } from "../src/lib/store"
import { shop } from "./fixtures"

function deps(over: Partial<SessionDeps> = {}, calls: string[] = []): SessionDeps {
  return {
    push: {
      getVapidKey: async () => "",
      registerPush: async () => undefined,
      unregisterPush: async (s) => {
        calls.push(`unregister:${s.id}`)
      },
    },
    endSession: async () => {
      calls.push("endSession")
    },
    store: {
      loadShops: async () => [],
      saveShops: async () => undefined,
      clear: async () => {
        calls.push("store.clear")
      },
    },
    currentEndpoint: async () => "https://push.example/1",
    unsubscribeLocal: async () => {
      calls.push("unsubscribeLocal")
    },
    clearSessionPrefs: () => {
      calls.push("clearPrefs")
    },
    ...over,
  }
}

const shops = [shop("home", { home: true, pushRegistered: true }), shop("b", { token: "jwt-b", pushRegistered: true })]

describe("logoutAll", () => {
  it("removes push first, then ends the session, then wipes the device", async () => {
    const calls: string[] = []
    const res = await logoutAll(shops, deps({}, calls))
    expect(calls.filter((c) => c.startsWith("unregister:")).sort()).toEqual(["unregister:b", "unregister:home"])
    expect(calls.indexOf("endSession")).toBeGreaterThan(calls.lastIndexOf("unregister:b"))
    expect(calls.indexOf("store.clear")).toBeGreaterThan(calls.indexOf("endSession"))
    expect(calls.indexOf("unsubscribeLocal")).toBeGreaterThan(calls.indexOf("store.clear"))
    expect(calls).toContain("clearPrefs")
    expect(res).toEqual({ pushStillAt: [], sessionStillOpen: false })
  })
  it("wipes tokens from IndexedDB, even when a shop is unreachable", async () => {
    await idbStore.saveShops(shops.map((s) => (s.id === "b" ? s : s)))
    const failing = deps({
      store: idbStore,
      push: { getVapidKey: async () => "", registerPush: async () => undefined, unregisterPush: vi.fn(async () => Promise.reject(new Error("offline"))) },
      endSession: async () => Promise.reject(new Error("offline")),
    })
    const res = await logoutAll(shops, failing)
    expect(await idbStore.loadShops()).toEqual([])
    expect(res.pushStillAt.map((s) => s.id).sort()).toEqual(["b", "home"])
    expect(res.sessionStillOpen).toBe(true)
  })
  it("clears the selected shop but keeps display preferences", () => {
    // Contract of clearSession: only the scope key goes.
    localStorage.setItem("medusify.lang", "de")
    localStorage.setItem("medusify.scope", "b")
    return import("../src/lib/prefs").then(({ prefs }) => {
      prefs.clearSession()
      expect(localStorage.getItem("medusify.scope")).toBeNull()
      expect(localStorage.getItem("medusify.lang")).toBe("de")
    })
  })
})

describe("removeForeignShop", () => {
  it("removes the push registration and then the shop with its token", async () => {
    const saved: string[][] = []
    const calls: string[] = []
    const d = deps({ store: { loadShops: async () => [], saveShops: async (l) => void saved.push(l.map((s) => s.id)), clear: async () => undefined } }, calls)
    const res = await removeForeignShop(shops[1]!, shops, d)
    expect(calls).toEqual(["unregister:b"])
    expect(saved).toEqual([["home"]])
    expect(res).toMatchObject({ pushLeft: false })
  })
})
