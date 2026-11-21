import { afterEach, describe, expect, it, vi } from "vitest"
import { DISCOUNT_CODE_TAKEN, catalogFailure, createDiscount } from "../src/lib/api"
import { checkCode, checkLimit, checkPercent, discountValue, sameDiscount, type Discount } from "../src/lib/discounts"
import { formatMoney } from "../src/lib/format"
import { shop } from "./fixtures"

const d = (o: Partial<Discount> = {}): Discount => ({
  id: "promo_1", code: "SOMMER20", status: "active", is_automatic: false, limit: null, used: 0, created_at: "2026-11-20T10:00:00Z",
  application_method: { type: "percentage", value: 20, currency_code: null, target_type: "order" }, ...o,
})

describe("discount codes", () => {
  it("a code is upper case without spaces, 3 to 32 characters of A–Z, digits, - and _", () => {
    expect(checkCode(" sommer 20 ")).toEqual({ ok: true, code: "SOMMER20" })
    expect(checkCode("ab")).toEqual({ ok: false, reason: "short" })
    expect(checkCode("A".repeat(33))).toEqual({ ok: false, reason: "long" })
    expect(checkCode("RABATT€")).toEqual({ ok: false, reason: "chars" })
    expect(checkCode("WINTER_2026-A")).toEqual({ ok: true, code: "WINTER_2026-A" })
  })
  it("per cent is above 0 and at most 100, two decimals at most", () => {
    expect(checkPercent("20")).toEqual({ ok: true, value: 20 })
    expect(checkPercent("12,5 %")).toEqual({ ok: true, value: 12.5 })
    expect(checkPercent("")).toEqual({ ok: false, reason: "empty" })
    expect(checkPercent("0")).toEqual({ ok: false, reason: "range" })
    expect(checkPercent("100,01")).toEqual({ ok: false, reason: "range" })
    expect(checkPercent("1.234")).toEqual({ ok: false, reason: "invalid" })
  })
  it("the limit is empty (none) or a whole number from 1", () => {
    expect(checkLimit("")).toEqual({ ok: true, value: null })
    expect(checkLimit("50")).toEqual({ ok: true, value: 50 })
    expect(checkLimit("0")).toEqual({ ok: false })
    expect(checkLimit("2,5")).toEqual({ ok: false })
  })
  it("shows what it takes off", () => {
    expect(discountValue(d(), "de")).toBe("20 %")
    expect(discountValue(d({ application_method: { type: "fixed", value: 5, currency_code: "eur", target_type: "order" } }), "de")).toBe(formatMoney(5, "eur", "de"))
    expect(discountValue(d({ application_method: null }), "de")).toBe("")
  })
  it("the same code with the same discount is the same; another value or currency is not", () => {
    const input = { code: "SOMMER20", type: "percentage" as const, value: 20, currency_code: null, limit: null }
    expect(sameDiscount(d(), input)).toBe(true)
    expect(sameDiscount(d(), { ...input, value: 25 })).toBe(false)
    const fixed = d({ application_method: { type: "fixed", value: 5, currency_code: "EUR", target_type: "order" } })
    expect(sameDiscount(fixed, { code: "SOMMER20", type: "fixed", value: 5, currency_code: "eur", limit: null })).toBe(true)
    expect(sameDiscount(fixed, { code: "SOMMER20", type: "fixed", value: 5, currency_code: "usd", limit: null })).toBe(false)
  })
  it("a paused code or one with another limit is not the one just created (review 2026-11-20)", () => {
    const input = { code: "SOMMER20", type: "percentage" as const, value: 20, currency_code: null, limit: null }
    expect(sameDiscount(d({ status: "inactive" }), input)).toBe(false)
    expect(sameDiscount(d({ status: "draft" }), input)).toBe(false)
    expect(sameDiscount(d({ limit: 50 }), input)).toBe(false)
    expect(sameDiscount(d({ limit: 50 }), { ...input, limit: 50 })).toBe(true)
  })
})

describe("creating a code when the answer gets lost", () => {
  afterEach(() => vi.unstubAllGlobals())
  const input = { code: "SOMMER20", type: "percentage" as const, value: 20, currency_code: null, limit: null }
  /** The first call (the create) fails the given way; the look-up by code answers with `found`. */
  const shopThat = (fail: () => Promise<Response>, found: Discount[]) => {
    const calls: string[] = []
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`)
      if (init?.method === "POST") return fail()
      return new Response(JSON.stringify({ promotions: found, count: found.length }), { status: 200 })
    }))
    return calls
  }

  it("the create went through but the answer was lost: the code is found and counts as made", async () => {
    const calls = shopThat(() => Promise.reject(new TypeError("network")), [d()])
    expect((await createDiscount(shop("s1"), input)).id).toBe("promo_1")
    expect(calls.filter((c) => c.startsWith("POST"))).toHaveLength(1)
    expect(calls.some((c) => c.includes("code=SOMMER20"))).toBe(true)
  })
  it("a code that exists with another discount is refused with its own message", async () => {
    shopThat(async () => new Response(JSON.stringify({ message: "Promotion with code SOMMER20 already exists" }), { status: 400 }), [d({ application_method: { type: "percentage", value: 10, currency_code: null, target_type: "order" } })])
    const err = await createDiscount(shop("s1"), input).then(() => null, (e: unknown) => e)
    expect(catalogFailure(err)).toEqual({ kind: "rejected", code: DISCOUNT_CODE_TAKEN })
  })
  it("a refusal for another reason stays that refusal when no such code exists", async () => {
    shopThat(async () => new Response(JSON.stringify({ message: "Invalid currency" }), { status: 400 }), [])
    const err = await createDiscount(shop("s1"), input).then(() => null, (e: unknown) => e)
    expect(catalogFailure(err)).toEqual({ kind: "rejected", reason: "Invalid currency" })
  })
})
