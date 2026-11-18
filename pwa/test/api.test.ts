import { describe, expect, it } from "vitest"
import { orderListParams } from "../src/lib/api"

describe("orderListParams", () => {
  it("sends one status[] per value, never a comma list", () => {
    const p = orderListParams({ offset: 0, scope: "active" })
    expect(p.getAll("status[]")).toEqual(["pending", "requires_action", "completed"])
    expect(p.has("status")).toBe(false)
  })
  it("canceled asks for canceled only, all asks for no status", () => {
    expect(orderListParams({ offset: 0, scope: "canceled" }).getAll("status[]")).toEqual(["canceled"])
    expect(orderListParams({ offset: 0, scope: "any" }).has("status[]")).toBe(false)
  })
  it("carries search and paging", () => {
    const p = orderListParams({ offset: 50, q: "Lindner", scope: "any" })
    expect(p.get("q")).toBe("Lindner")
    expect(p.get("offset")).toBe("50")
    expect(p.get("order")).toBe("-created_at")
  })
})

import { vi } from "vitest"
import { loginMethods } from "../src/lib/api"
import { shop } from "./fixtures"

describe("loginMethods", () => {
  const answer = (body: unknown, status = 200) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })))
  const providers = (...p: [string, string][]) => ({ providers: p.map(([id, flow]) => ({ id, identifier: id, flow })) })

  it("offers what the shop allows for admins", async () => {
    answer(providers(["emailpass", "credentials"], ["google", "redirect"]))
    expect(await loginMethods(shop("a", { home: true }))).toEqual({ password: true, google: true })
    answer(providers(["google", "redirect"]))
    expect(await loginMethods(shop("a", { home: true }))).toEqual({ password: false, google: true })
  })
  it("a provider that is not a redirect flow is not offered as Google", async () => {
    answer(providers(["google", "credentials"], ["emailpass", "credentials"]))
    expect(await loginMethods(shop("a"))).toEqual({ password: true, google: false })
  })
  it("falls back to the password form when the shop does not answer", async () => {
    answer({ message: "x" }, 500)
    expect(await loginMethods(shop("a"))).toEqual({ password: true, google: false })
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))))
    expect(await loginMethods(shop("a"))).toEqual({ password: true, google: false })
    answer({ providers: [] })
    expect(await loginMethods(shop("a"))).toEqual({ password: true, google: false })
  })
})
