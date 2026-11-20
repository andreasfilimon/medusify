import { describe, expect, it } from "vitest"
import { MAX_PRODUCT_CODE, cleanProductCode, pickProductCode, pickTrackingCode } from "../src/lib/scan"

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

describe("picking the product code from a frame", () => {
  const read = (format: string, text: string, isValid = true) => ({ format, text, isValid })
  it("takes the retail code, even when a QR code was read first", () => {
    expect(pickProductCode([read("QRCode", "https://shop.example.invalid/p/1"), read("EAN-13", "4006381333931")])).toBe("4006381333931")
  })
  it("takes UPC and EAN-8 as retail codes too", () => {
    expect(pickProductCode([read("Code128", "SHELF-7"), read("UPC-A", "036000291452")])).toBe("036000291452")
    expect(pickProductCode([read("Code128", "SHELF-7"), read("EAN-8", "96385074")])).toBe("96385074")
  })
  it("falls back to the first valid code, keeping its letter case (a SKU is case-sensitive)", () => {
    expect(pickProductCode([read("Code128", "bad", false), read("Code128", "Mug-Blue-L")])).toBe("Mug-Blue-L")
  })
  it("gives nothing for an empty frame, invalid reads and codes the lookup would refuse", () => {
    expect(pickProductCode([])).toBe("")
    expect(pickProductCode([read("EAN-13", "4006381333931", false)])).toBe("")
    expect(pickProductCode([read("QRCode", "x".repeat(MAX_PRODUCT_CODE + 1))])).toBe("")
  })
  it("strips the symbology prefix, blanks and control characters", () => {
    expect(cleanProductCode("]E0 4006381333931\r\n")).toBe("4006381333931")
    expect(cleanProductCode("]C1AB 12")).toBe("AB12")
  })
})
