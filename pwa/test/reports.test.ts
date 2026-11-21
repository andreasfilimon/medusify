import { describe, expect, it } from "vitest"
import { addDays, change, currencyRows, dayIn, daysBetween, rangeFor, rangeProblem, rangeText, returnRate, type Report } from "../src/lib/reports"

describe("report periods", () => {
  it("the day is the one on the device's clock", () => {
    const t = new Date("2026-03-01T23:30:00Z")
    expect(dayIn(t, "UTC")).toBe("2026-03-01")
    expect(dayIn(t, "Europe/Vienna")).toBe("2026-03-02")
  })

  it("7 and 30 days end today, the month starts on the 1st", () => {
    expect(rangeFor("7d", "2026-03-04")).toEqual({ from: "2026-02-26", to: "2026-03-04" })
    expect(rangeFor("30d", "2026-03-04")).toEqual({ from: "2026-02-03", to: "2026-03-04" })
    expect(rangeFor("month", "2026-03-04")).toEqual({ from: "2026-03-01", to: "2026-03-04" })
    expect(daysBetween("2026-02-26", "2026-03-04")).toBe(7)
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29") // leap day
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30") // clock change in Europe: still one calendar day
  })

  it("a period typed by hand: the end not before the start, at most 400 days", () => {
    expect(rangeProblem({ from: "2026-03-01", to: "2026-03-01" })).toBeNull()
    expect(rangeProblem({ from: "2026-03-02", to: "2026-03-01" })).toBe("order")
    expect(rangeProblem({ from: "", to: "2026-03-01" })).toBe("order")
    expect(rangeProblem({ from: "2025-01-01", to: "2026-02-04" })).toBeNull() // 400 days
    expect(rangeProblem({ from: "2025-01-01", to: "2026-02-05" })).toBe("long")
  })

  it("reads as a range of calendar days, whatever the device's zone", () => {
    expect(rangeText({ from: "2026-03-01", to: "2026-03-07" }, "en")).toMatch(/^1\s*–\s*7 Mar$/) // en-GB, as the app formats English
    expect(rangeText({ from: "2026-03-01", to: "2026-03-01" }, "de")).toBe("1. März")
    expect(rangeText({ from: "2025-12-29", to: "2026-01-04" }, "de")).toMatch(/2025.*2026/)
  })
})

describe("report numbers", () => {
  it("the move against the period before, in whole percent", () => {
    expect(change(110, 100)).toEqual({ kind: "up", pct: 10 })
    expect(change(80, 100)).toEqual({ kind: "down", pct: 20 })
    expect(change(100.2, 100)).toEqual({ kind: "same", pct: 0 })
    expect(change(5, 0)).toEqual({ kind: "new" })
    expect(change(0, 0)).toEqual({ kind: "none" })
  })

  it("one row per currency of either period, never added up", () => {
    const p = (cur: Report["current"]["currencies"]) => ({ from: "", to: "", orders: 0, units: 0, returned_units: 0, currencies: cur })
    const r = {
      current: p([{ currency_code: "eur", orders: 2, revenue: 50, average: 25 }]),
      previous: p([{ currency_code: "usd", orders: 1, revenue: 9, average: 9 }, { currency_code: "eur", orders: 1, revenue: 40, average: 40 }]),
    } as Report
    expect(currencyRows(r).map((x) => [x.code, x.now?.revenue ?? null, x.before?.revenue ?? null])).toEqual([["eur", 50, 40], ["usd", null, 9]])
  })

  it("the return rate is the share of the sold units that came back", () => {
    expect(returnRate({ from: "", to: "", orders: 3, currencies: [], units: 8, returned_units: 1 })).toBe(12.5)
    expect(returnRate({ from: "", to: "", orders: 0, currencies: [], units: 0, returned_units: 0 })).toBeNull()
  })
})
