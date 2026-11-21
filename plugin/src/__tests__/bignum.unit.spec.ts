import { BigNumber } from "@medusajs/framework/utils"
import { toNumber } from "../lib/bignum"

describe("toNumber", () => {
  it("reads every form Medusa returns money in", () => {
    expect(toNumber(12.5)).toBe(12.5)
    expect(toNumber("12.5")).toBe(12.5)
    expect(toNumber({ value: "12.5" })).toBe(12.5)
    expect(toNumber(null)).toBe(0)
    expect(toNumber(undefined)).toBe(0)
  })

  it("reads a BigNumber instance (the order module's preview and summaries hand these out)", () => {
    expect(toNumber(new BigNumber(32.5) as never)).toBe(32.5)
    expect(toNumber(new BigNumber("-12.5") as never)).toBe(-12.5)
  })
})
