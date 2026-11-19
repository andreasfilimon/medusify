import { describe, expect, it } from "vitest"
import { amountFieldText, checkAmount, fractionDigits, fromMinor, toMinor } from "../src/lib/amount"

describe("currency digits", () => {
  it("knows euro, yen and dinar", () => {
    expect(fractionDigits("eur")).toBe(2)
    expect(fractionDigits("jpy")).toBe(0)
    expect(fractionDigits("kwd")).toBe(3)
  })
  it("falls back to 2 for an unknown code", () => expect(fractionDigits("not a code")).toBe(2))
  it("converts without floating point drift", () => {
    expect(toMinor(0.1 + 0.2, "eur")).toBe(30)
    expect(fromMinor(1999, "eur")).toBe(19.99)
  })
})

describe("refund amount check", () => {
  const ok = (raw: string, max = 44.98, cur = "eur") => checkAmount(raw, cur, max)
  it("takes comma and point", () => {
    expect(ok("12,5")).toEqual({ ok: true, value: 12.5 })
    expect(ok("12.50")).toEqual({ ok: true, value: 12.5 })
  })
  it("takes exactly the maximum", () => expect(ok("44,98")).toEqual({ ok: true, value: 44.98 }))
  it("rejects one cent above the maximum", () => expect(ok("44,99")).toEqual({ ok: false, reason: "above" }))
  it("rejects far above the maximum", () => expect(ok("1000")).toEqual({ ok: false, reason: "above" }))
  it("is not fooled by float sums at the limit", () => expect(checkAmount("0,3", "eur", 0.1 + 0.2)).toEqual({ ok: true, value: 0.3 }))
  it("rejects empty, zero, text, negative and thousands separators", () => {
    expect(ok("")).toEqual({ ok: false, reason: "empty" })
    expect(ok("  ")).toEqual({ ok: false, reason: "empty" })
    expect(ok("0")).toEqual({ ok: false, reason: "zero" })
    expect(ok("0,00")).toEqual({ ok: false, reason: "zero" })
    expect(ok("abc")).toEqual({ ok: false, reason: "invalid" })
    expect(ok("-5")).toEqual({ ok: false, reason: "invalid" })
    expect(ok("1.000,50", 5000)).toEqual({ ok: false, reason: "invalid" })
    expect(ok("1e2")).toEqual({ ok: false, reason: "invalid" })
  })
  it("rejects more decimals than the currency has", () => {
    expect(ok("1,234")).toEqual({ ok: false, reason: "decimals" })
    expect(checkAmount("5,5", "jpy", 100)).toEqual({ ok: false, reason: "decimals" })
    expect(checkAmount("5", "jpy", 100)).toEqual({ ok: true, value: 5 })
  })
  it("shows an amount the way the field takes it", () => {
    expect(amountFieldText(44.98, "eur", "de")).toBe("44,98")
    expect(amountFieldText(1234.5, "eur", "en")).toBe("1234.50")
    expect(amountFieldText(7, "jpy", "de")).toBe("7")
  })
})
