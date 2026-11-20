import { describe, expect, it } from "vitest"
import { MAX_STOCK, basePrice, editableInventory, isLow, listPrice, parseCount, primaryCurrency, productStock, variantLabel, type VariantView } from "../src/lib/catalog"

const variant = (o: Partial<VariantView> = {}): VariantView => ({
  id: "v1", title: "Default", sku: null, barcode: null, ean: null, upc: null, manage_inventory: true, allow_backorder: false,
  prices: [], inventory: [], stock_total: 0, stock_editable: true, ...o,
})
const level = { location_id: "l1", location_name: "Lager", stocked: 4, reserved: 1, available: 3, incoming: 0 }

describe("stock of a product", () => {
  it("adds the sellable units of its tracked variants", () => {
    expect(productStock({ variants: [variant({ stock_total: 3 }), variant({ stock_total: 4 })] })).toBe(7)
  })
  it("ignores variants that do not track stock", () => {
    expect(productStock({ variants: [variant({ stock_total: null }), variant({ stock_total: 4 })] })).toBe(4)
  })
  it("is null when no variant tracks stock (not 0: that would read as sold out)", () => {
    expect(productStock({ variants: [variant({ stock_total: null })] })).toBeNull()
    expect(productStock({ variants: [] })).toBeNull()
  })
})

describe("low stock", () => {
  it("is low at the threshold and below, not above", () => {
    expect(isLow(5, 5)).toBe(true)
    expect(isLow(6, 5)).toBe(false)
    expect(isLow(0, 5)).toBe(true)
  })
  it("a threshold of 0 means only when it is gone", () => {
    expect(isLow(0, 0)).toBe(true)
    expect(isLow(1, 0)).toBe(false)
  })
  it("a product without tracking is never low", () => expect(isLow(null, 100)).toBe(false))
})

describe("what the app may count", () => {
  it("gives the inventory item of a counted variant", () => {
    const inv = { inventory_item_id: "i1", required_quantity: 1, levels: [level] }
    expect(editableInventory(variant({ inventory: [inv] }))).toBe(inv)
  })
  it("gives nothing for a kit or an untracked variant, even if inventory is listed", () => {
    const inv = { inventory_item_id: "i1", required_quantity: 2, levels: [level] }
    expect(editableInventory(variant({ inventory: [inv], stock_editable: false }))).toBeNull()
  })
  it("gives nothing for a variant without inventory", () => expect(editableInventory(variant())).toBeNull())
})

describe("variant label", () => {
  it("hides the placeholder title every simple product carries", () => {
    expect(variantLabel({ title: "Default" }, "Mug")).toBe("")
    expect(variantLabel({ title: " default " }, "Mug")).toBe("")
    expect(variantLabel({ title: "" }, "Mug")).toBe("")
  })
  it("hides a title that repeats the product", () => expect(variantLabel({ title: "Mug" }, "Mug")).toBe(""))
  it("shows a real variant name", () => expect(variantLabel({ title: "Blue / L" }, "Mug")).toBe("Blue / L"))
})

describe("a count typed into the field", () => {
  it("takes whole numbers up to the limit", () => {
    expect(parseCount("0")).toBe(0)
    expect(parseCount("12")).toBe(12)
    expect(parseCount(" 1 200 ")).toBe(1200)
    expect(parseCount(String(MAX_STOCK))).toBe(MAX_STOCK)
  })
  it("refuses the limit plus one, decimals, signs, letters and nothing", () => {
    expect(parseCount(String(MAX_STOCK + 1))).toBeNull()
    expect(parseCount("1,5")).toBeNull()
    expect(parseCount("-1")).toBeNull()
    expect(parseCount("1e3")).toBeNull()
    expect(parseCount("")).toBeNull()
    expect(parseCount("12345678")).toBeNull()
  })
})

describe("prices", () => {
  const prices = [
    { id: "p1", currency_code: "eur", amount: 10, base: true },
    { id: "p2", currency_code: "eur", amount: 8, base: false },
    { id: "p3", currency_code: "usd", amount: 11, base: true },
  ]
  it("finds the plain price of a currency, never a rule or tier price", () => {
    expect(basePrice({ prices }, "EUR")?.id).toBe("p1")
    expect(basePrice({ prices: [prices[1]!] }, "eur")).toBeUndefined()
  })
  it("the list shows the cheapest plain price of the first currency and says when variants differ", () => {
    const p = { variants: [variant({ prices }), variant({ prices: [{ id: "p4", currency_code: "eur", amount: 12, base: true }] })] }
    expect(primaryCurrency(p)).toBe("eur")
    expect(listPrice(p)).toEqual({ amount: 10, currency: "eur", several: true })
    expect(listPrice({ variants: [variant({ prices: [prices[0]!] })] })).toEqual({ amount: 10, currency: "eur", several: false })
  })
  it("has no price to show when there is only a rule price", () => expect(listPrice({ variants: [variant({ prices: [prices[1]!] })] })).toBeNull())
})
