import { describe, expect, it } from "vitest"
import { EMPTY_ADDRESS, addLine, checkAddress, estimate, isEmail, lineMax, manualOrderBody, setQuantity, unitPrice, type ManualLine } from "../src/lib/manual-order"

const line = (o: Partial<ManualLine> = {}): Omit<ManualLine, "quantity"> => ({ variant_id: "v1", title: "Tasse", variant: "", unit: 12.5, max: null, ...o })

describe("an order by hand", () => {
  it("takes the plain catalog price of the region's currency, never a rule or tier price", () => {
    const prices = [
      { id: "p1", currency_code: "eur", amount: 10, base: false },
      { id: "p2", currency_code: "EUR", amount: 12.5, base: true },
      { id: "p3", currency_code: "usd", amount: 14, base: true },
    ]
    expect(unitPrice({ prices }, "eur")).toBe(12.5)
    expect(unitPrice({ prices }, "chf")).toBeNull()
  })
  it("limits the count to the stock only when the shop tracks it and does not oversell", () => {
    expect(lineMax({ manage_inventory: true, allow_backorder: false, stock_total: 3 })).toBe(3)
    expect(lineMax({ manage_inventory: true, allow_backorder: true, stock_total: 3 })).toBeNull()
    expect(lineMax({ manage_inventory: false, allow_backorder: false, stock_total: null })).toBeNull()
    expect(lineMax({ manage_inventory: true, allow_backorder: false, stock_total: -2 })).toBe(0)
  })
  it("adding the same variant again counts up, never past the stock; a sold-out variant is not added", () => {
    let lines = addLine([], line({ max: 2 }))
    lines = addLine(lines, line({ max: 2 }))
    lines = addLine(lines, line({ max: 2 }))
    expect(lines).toEqual([{ ...line({ max: 2 }), quantity: 2 }])
    expect(addLine([], line({ variant_id: "v2", max: 0 }))).toEqual([])
  })
  it("a count of 0 takes the line out, more than the stock is cut to it", () => {
    const lines = [{ ...line({ max: 5 }), quantity: 2 }]
    expect(setQuantity(lines, "v1", 9)[0]!.quantity).toBe(5)
    expect(setQuantity(lines, "v1", 0)).toEqual([])
  })
  it("adds up in minor units: 3 × 0.1 + 0.2 shipping is 0.5, not 0.5000000001", () => {
    const lines = [{ ...line({ unit: 0.1 }), quantity: 3 }]
    expect(estimate(lines, 0.2)).toEqual({ items: 0.3, total: 0.5, complete: true })
    expect(estimate([...lines, { ...line({ variant_id: "v2", unit: null }), quantity: 1 }], null).complete).toBe(false)
    expect(estimate([{ ...line({ unit: 1500 }), quantity: 2 }], null, 0)).toEqual({ items: 3000, total: 3000, complete: true })
  })
  it("knows a plausible email", () => {
    expect(isEmail(" kundin@example.invalid ")).toBe(true)
    expect(isEmail("Greta Lindner")).toBe(false)
    expect(isEmail("kundin@example")).toBe(false)
  })
  it("no address is fine, a started one needs a name or company, street, postcode, town and country", () => {
    expect(checkAddress(EMPTY_ADDRESS)).toEqual({ ok: true, address: null })
    expect(checkAddress({ ...EMPTY_ADDRESS, city: "Wien" })).toEqual({ ok: false, missing: ["last_name", "address_1", "postal_code", "country_code"] })
    const full = { ...EMPTY_ADDRESS, company: " Demo GmbH ", address_1: "Teststrasse 3", postal_code: "1010", city: "Wien", country_code: "at" }
    expect(checkAddress(full)).toEqual({ ok: true, address: { ...full, company: "Demo GmbH" } })
  })
  it("sends only the filled address fields, the country in lower case", () => {
    const body = manualOrderBody({
      region_id: "reg_1", customer_id: null, email: "kundin@example.invalid", items: [{ variant_id: "v1", quantity: 2 }], shipping_option_id: null, paid: false, idempotency_key: "k-12345678",
      address: { ...EMPTY_ADDRESS, last_name: "Kundin", address_1: "Teststrasse 3", postal_code: "1010", city: "Wien", country_code: "AT" },
    })
    expect(body.shipping_address).toEqual({ last_name: "Kundin", address_1: "Teststrasse 3", postal_code: "1010", city: "Wien", country_code: "at" })
    expect(manualOrderBody({ ...body, address: null }).shipping_address).toBeNull()
  })
})
