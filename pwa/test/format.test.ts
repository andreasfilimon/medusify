import { describe, expect, it } from "vitest"
import { cleanTrackingNumber, dayGroup, formatMoney, relativeTime } from "../src/lib/format"

describe("format", () => {
  it("formats amounts in major units with the currency sign", () => {
    expect(formatMoney(43.9, "eur", "de").replace(/\s/g, " ")).toBe("€ 43,90")
    expect(formatMoney(43.9, "usd", "en")).toBe("US$43.90")
  })
  it("falls back for an unknown currency code", () => {
    expect(formatMoney(5, "zz", "en")).toContain("5")
  })
  it("strips whitespace and the barcode symbology prefix from tracking numbers", () => {
    expect(cleanTrackingNumber("]C0 1Z 999 AA1")).toBe("1Z999AA1")
    expect(cleanTrackingNumber("  RR123456789DE ")).toBe("RR123456789DE")
  })
  it("words relative times", () => {
    const now = Date.parse("2026-11-16T12:00:00Z")
    expect(relativeTime("2026-11-16T11:56:00Z", now, "de")).toBe("vor 4 Min")
    expect(relativeTime("2026-11-16T09:00:00Z", now, "en")).toBe("3 h ago")
    expect(relativeTime("2026-11-16T11:59:59Z", now, "de")).toBe("gerade eben")
  })
  it("groups days", () => {
    const now = new Date(2026, 10, 16, 12).getTime()
    expect(dayGroup(new Date(2026, 10, 16, 8).toISOString(), now, "de").label).toBe("Heute")
    expect(dayGroup(new Date(2026, 10, 15, 8).toISOString(), now, "en").label).toBe("Yesterday")
  })
})

describe("cleanTrackingNumber with GS1 text", () => {
  it("drops the brackets around an application identifier and the group separator", () => {
    expect(cleanTrackingNumber("(00) 3404 3416 1234 5678 90")).toBe("00340434161234567890")
    expect(cleanTrackingNumber("]C1003404341612345678\u001d90")).toBe("00340434161234567890")
  })
})
