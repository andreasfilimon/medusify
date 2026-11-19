import { describe, expect, it } from "vitest"
import { pickTrackingCode } from "../src/lib/scan"

// The codes of a real GLS label (Austria), in the order the decoder returns them (measured 2026-11-19, contents replaced).
const dm = (n: number) => ({ format: "DataMatrix", text: "A".repeat(20) + "|" + "x".repeat(n - 21), isValid: true })
const glsLabel = [dm(123), { format: "ITF", text: "900000000017", isValid: true }, dm(113)]

describe("picking the parcel number from a label", () => {
  it("takes the 1D parcel number, not the 2D code that comes first", () => {
    expect(pickTrackingCode(glsLabel)).toBe("900000000017")
  })
  it("a frame with only the 2D codes of a label gives nothing", () => {
    expect(pickTrackingCode([dm(123), dm(113)])).toBe("")
  })
  it("a 1D code wins over a short 2D code read before it", () => {
    expect(pickTrackingCode([{ format: "QRCode", text: "ROUTE12345", isValid: true }, { format: "Code128", text: "00340434161094042557", isValid: true }])).toBe(
      "00340434161094042557",
    )
  })
  it("a 2D code that holds only a parcel number counts", () => {
    expect(pickTrackingCode([{ format: "QRCode", text: "RR123456789AT", isValid: true }])).toBe("RR123456789AT")
  })
  it("skips invalid reads and strips the symbology prefix", () => {
    expect(pickTrackingCode([{ format: "Code128", text: "999", isValid: false }, { format: "Code128", text: "]C0 JJD 0001 2345 6789", isValid: true }])).toBe(
      "JJD000123456789",
    )
  })
})
