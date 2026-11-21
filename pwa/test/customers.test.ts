import { describe, expect, it } from "vitest"
import { formatMoney } from "../src/lib/format"
import { addressLines, customerTitle, spentText, type CustomerView } from "../src/lib/customers"

const c = (o: Partial<CustomerView> = {}): CustomerView => ({
  id: "cus_1", email: "anna@example.invalid", first_name: null, last_name: null, company_name: null, phone: null, has_account: false,
  created_at: "2026-11-01T10:00:00Z", stats: { orders: 0, spent: [], last_order_at: null, order_name: null }, ...o,
})

describe("customers", () => {
  it("the title is the name, else the company, else the name on the newest order, else the email", () => {
    expect(customerTitle(c({ first_name: "Anna", last_name: "Demo", company_name: "Holz GmbH" }))).toBe("Anna Demo")
    expect(customerTitle(c({ company_name: "Holz GmbH", stats: { ...c().stats, order_name: "Anna D." } }))).toBe("Holz GmbH")
    expect(customerTitle(c({ stats: { ...c().stats, order_name: "Anna D." } }))).toBe("Anna D.")
    expect(customerTitle(c())).toBe("anna@example.invalid")
    expect(customerTitle(c({ email: null }))).toBe("-")
  })
  it("an older plugin sends no order name: the email shows", () => {
    const old = c({ stats: { orders: 1, spent: [], last_order_at: null } })
    expect(customerTitle(old)).toBe("anna@example.invalid")
  })
  it("spend is one amount per currency, never added up", () => {
    const text = spentText({ orders: 2, spent: [{ currency_code: "eur", amount: 12.5 }, { currency_code: "usd", amount: 9 }], last_order_at: null }, "de")
    expect(text).toBe(`${formatMoney(12.5, "eur", "de")} · ${formatMoney(9, "usd", "de")}`)
    expect(spentText(c().stats, "de")).toBe("")
  })
  it("an address reads like an envelope and leaves empty lines out", () => {
    expect(addressLines({ id: "a", first_name: "Anna", last_name: "Demo", company: null, address_1: "Teststrasse 2", address_2: "", postal_code: "1010", city: "Wien", province: null, country_code: "at", phone: null, is_default_shipping: true, is_default_billing: false })).toEqual(["Anna Demo", "Teststrasse 2", "1010 Wien", "AT"])
  })
})
