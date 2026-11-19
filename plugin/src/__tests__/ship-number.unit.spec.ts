import { labelsFor, mainNumberTarget } from "../lib/ship"

describe("mainNumberTarget: which package the typed number belongs to", () => {
  const none = new Set<string>()
  it("the package packed by this request", () => {
    expect(mainNumberTarget(["old", "new"], new Set(["new"]), undefined)).toEqual({ target: "new", ambiguous: false })
  })
  it("the only package waiting, when nothing is packed now", () => {
    expect(mainNumberTarget(["old"], none, undefined)).toEqual({ target: "old", ambiguous: false })
  })
  it("two packages packed now (two shipping profiles): no package, ambiguous", () => {
    expect(mainNumberTarget(["a", "b"], new Set(["a", "b"]), undefined)).toEqual({ ambiguous: true })
  })
  it("two packages waiting: ambiguous, unless all but one have a number of their own", () => {
    expect(mainNumberTarget(["a", "b"], none, undefined)).toEqual({ ambiguous: true })
    expect(mainNumberTarget(["a", "b"], none, { a: "N1" })).toEqual({ target: "b", ambiguous: false })
  })
  it("this request packed only a voucher (no parcel): the parcel waiting takes the number", () => {
    expect(mainNumberTarget(["parcel"], new Set(["voucher"]), undefined)).toEqual({ target: "parcel", ambiguous: false })
  })
  it("nothing open: no target, not ambiguous", () => {
    expect(mainNumberTarget([], none, undefined)).toEqual({ ambiguous: false })
  })
})

describe("labelsFor", () => {
  it("keeps a carrier's label as it is, a relative PDF path included, and adds the typed number once", () => {
    const existing = [{ tracking_number: "C1", tracking_url: "https://c.invalid/C1", label_url: "/api/v1/pdf" }]
    expect(labelsFor(existing, { number: "T2", url: "https://t.invalid/T2" })).toEqual([
      { tracking_number: "C1", tracking_url: "https://c.invalid/C1", label_url: "/api/v1/pdf" },
      { tracking_number: "T2", tracking_url: "https://t.invalid/T2", label_url: "" },
    ])
    expect(labelsFor(existing, { number: "C1" })).toHaveLength(1)
  })
})

describe("groupsToFulfill and locationFor: an order split by shipping profile", () => {
  const { groupsToFulfill, locationFor } = require("../lib/ship") as typeof import("../lib/ship")
  const order = {
    id: "o1",
    status: "pending",
    shipping_methods: [{ shipping_option_id: "so_std" }, { shipping_option_id: "so_bulky" }],
    fulfillments: [],
    items: [
      { id: "li_std", quantity: 1, requires_shipping: true, variant: { product: { shipping_profile: { id: "sp_std" } } } },
      { id: "li_bulky", quantity: 1, requires_shipping: true, variant: { product: { shipping_profile: { id: "sp_bulky" } } } },
      { id: "li_custom", quantity: 1, requires_shipping: true },
      { id: "li_voucher", quantity: 1, requires_shipping: false },
    ],
  }
  const profiles = new Map([["so_std", "sp_std"], ["so_bulky", "sp_bulky"]])

  it("one group per profile with the option of that profile, goods without shipping apart, custom lines with a profile group", () => {
    const groups = groupsToFulfill(order, profiles)
    expect(groups.map((g) => [g.shipping_option_id, g.requires_shipping, g.items.map((i) => i.id)])).toEqual([
      ["so_std", true, ["li_std", "li_custom"]],
      ["so_bulky", true, ["li_bulky"]],
      [undefined, false, ["li_voucher"]],
    ])
  })

  it("the chosen location applies to the first option's group and to groups without an option, not to another option's group", () => {
    const [std, bulky, voucher] = groupsToFulfill(order, profiles)
    expect(locationFor(std!, ["so_std", "so_bulky"], "sloc_wien")).toBe("sloc_wien")
    expect(locationFor(bulky!, ["so_std", "so_bulky"], "sloc_wien")).toBeUndefined()
    expect(locationFor(voucher!, ["so_std", "so_bulky"], "sloc_wien")).toBe("sloc_wien")
  })
})
