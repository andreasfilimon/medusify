import { describe, expect, it } from "vitest"
import { AMOUNT_DECIMALS, ApiError, BELOW_ZERO, CURRENCY_NOT_SUPPORTED, NOTHING_TO_UNDO, NO_LOCATION, catalogFailure } from "../src/lib/api"
import { catalogErrorText } from "../src/lib/catalog-text"
import { makeT } from "../src/lib/i18n"

const t = makeT("de")

describe("what a failed catalog call means", () => {
  it("a lost answer, a server error and a conflict are unknown: the same request may be sent again", () => {
    expect(catalogFailure(new ApiError("network"))).toEqual({ kind: "unknown" })
    expect(catalogFailure(new ApiError("server", 500))).toEqual({ kind: "unknown" })
    expect(catalogFailure(new ApiError("rejected", 409, "busy"))).toEqual({ kind: "unknown" })
    expect(catalogFailure(new Error("boom"))).toEqual({ kind: "unknown" })
  })
  it("a 401 is a signed-out session, a 403 a missing right", () => {
    expect(catalogFailure(new ApiError("unauthorized", 401))).toEqual({ kind: "auth" })
    expect(catalogFailure(new ApiError("rejected", 403, "nope"))).toEqual({ kind: "forbidden" })
  })
  it("a 404 without a medusify code is a plugin older than 0.3.0", () => {
    expect(catalogFailure(new ApiError("notfound", 404, "Not Found"))).toEqual({ kind: "old" })
  })
  it("a 404 with a medusify code is the shop's own answer, not an old plugin", () => {
    expect(catalogFailure(new ApiError("notfound", 404, "medusify:no_product"))).toEqual({ kind: "rejected", code: "medusify:no_product" })
  })
  it("a refusal carries the shop's code or its reason", () => {
    expect(catalogFailure(new ApiError("rejected", 400, BELOW_ZERO))).toEqual({ kind: "rejected", code: BELOW_ZERO })
    expect(catalogFailure(new ApiError("rejected", 400, "Title is required"))).toEqual({ kind: "rejected", reason: "Title is required" })
  })
})

describe("the sentence for it", () => {
  const text = (e: unknown) => catalogErrorText(t, e)
  it("a lost answer says that tapping again does not book twice", () => {
    const r = text(new ApiError("network"))
    expect(r.unknown).toBe(true)
    expect(r.text).toContain("nicht doppelt")
  })
  it("words every refusal the plugin knows, none of them as a raw code", () => {
    for (const code of [BELOW_ZERO, NOTHING_TO_UNDO, AMOUNT_DECIMALS, CURRENCY_NOT_SUPPORTED, NO_LOCATION]) {
      const r = text(new ApiError("rejected", 400, code))
      expect(r.unknown).toBe(false)
      expect(r.text).not.toContain("medusify:")
      expect(r.text.length).toBeGreaterThan(10)
    }
  })
  it("tells below-zero apart from the others", () => {
    expect(text(new ApiError("rejected", 400, BELOW_ZERO)).text).toContain("unter 0")
  })
  it("an unknown refusal shows the shop's reason", () => {
    expect(text(new ApiError("rejected", 400, "Title is required")).text).toContain("Title is required")
  })
  it("a missing right and an old plugin have their own sentence", () => {
    expect(text(new ApiError("rejected", 403, "x")).text).toContain("Berechtigung")
    expect(text(new ApiError("notfound", 404, "Not Found")).text).toContain("0.3.0")
  })
})
