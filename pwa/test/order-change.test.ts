import { describe, expect, it } from "vitest"
import { ApiError } from "../src/lib/api"
import { changeBody, changeContent, changeErrorCode, changeLines, changeState, moneyWay } from "../src/lib/order-change"
import type { Order, OrderItem } from "../src/lib/types"

const item = (o: Partial<OrderItem> & { id: string }): OrderItem => ({ title: "Tasse", quantity: 2, unit_price: 12.5, total: 25, variant_id: `var_${o.id}`, ...o })
const order = (items: OrderItem[]): Pick<Order, "items" | "total"> => ({ items, total: 25 })
const claim = { reason: "production_failure" as const, type: "refund" as const }

describe("changing an order", () => {
  it("an edit offers every line and never goes below what was already sent", () => {
    const o = order([item({ id: "a", quantity: 3, detail: { fulfilled_quantity: 2 } }), item({ id: "b" })])
    const lines = changeLines(o, "edit")
    expect(lines.map((l) => [l.id, l.start, l.min])).toEqual([["a", 3, 2], ["b", 2, 0]])
    // asking for 0 of a line with 2 sent sends 2: Medusa would refuse anything lower
    expect(changeBody("edit", lines, { a: 0 }, [], claim, o)).toEqual({ kind: "edit", items: [{ id: "a", quantity: 2 }], add: [] })
  })

  it("an edit that changes nothing is no request; a line set back to its count is left out", () => {
    const o = order([item({ id: "a" })])
    const lines = changeLines(o, "edit")
    expect(changeBody("edit", lines, {}, [], claim, o)).toBeNull()
    expect(changeBody("edit", lines, { a: 2 }, [], claim, o)).toBeNull()
    expect(changeBody("edit", lines, { a: 2 }, [{ variant_id: "v9", quantity: 1 }], claim, o)).toEqual({ kind: "edit", items: [], add: [{ variant_id: "v9", quantity: 1 }] })
  })

  it("an exchange takes back only units that were sent and are not on a return, and needs lines both ways", () => {
    const o = order([
      item({ id: "a", quantity: 3, detail: { fulfilled_quantity: 3, return_requested_quantity: 1 } }),
      item({ id: "b", detail: { fulfilled_quantity: 0 } }),
    ])
    const lines = changeLines(o, "exchange")
    expect(lines.map((l) => [l.id, l.max])).toEqual([["a", 2]])
    expect(changeBody("exchange", lines, { a: 5 }, [], claim, o)).toBeNull()
    expect(changeBody("exchange", lines, {}, [{ variant_id: "v9", quantity: 1 }], claim, o)).toBeNull()
    expect(changeBody("exchange", lines, { a: 5 }, [{ variant_id: "v9", quantity: 1 }, { variant_id: "v8", quantity: 0 }], claim, o)).toEqual({
      kind: "exchange",
      return_items: [{ id: "a", quantity: 2 }],
      add: [{ variant_id: "v9", quantity: 1 }],
    })
  })

  it("a claim covers sent units; a replacement sends the same variants again, a refund sends nothing", () => {
    const o = order([item({ id: "a", detail: { fulfilled_quantity: 2 } }), item({ id: "b", detail: { fulfilled_quantity: 0 } }), item({ id: "c", variant_id: null, detail: { fulfilled_quantity: 1 } })])
    const lines = changeLines(o, "claim")
    expect(lines.map((l) => l.id)).toEqual(["a", "c"])
    expect(changeBody("claim", lines, { a: 1, c: 1 }, [{ variant_id: "v9", quantity: 1 }], claim, o)).toEqual({
      kind: "claim",
      type: "refund",
      items: [{ id: "a", quantity: 1, reason: "production_failure" }, { id: "c", quantity: 1, reason: "production_failure" }],
      add: [],
    })
    const replace = changeBody("claim", lines, { a: 1, c: 1 }, [], { reason: "wrong_item", type: "replace" }, o)
    // the line without a variant (deleted product) cannot be sent again
    expect(replace && replace.kind === "claim" ? replace.add : null).toEqual([{ variant_id: "var_a", quantity: 1 }])
  })

  it("the key content does not depend on the order of the lines", () => {
    const a = changeContent({ kind: "edit", items: [{ id: "x", quantity: 1 }, { id: "y", quantity: 2 }], add: [] })
    const b = changeContent({ kind: "edit", items: [{ id: "y", quantity: 2 }, { id: "x", quantity: 1 }], add: [] })
    expect(a).toBe(b)
    expect(changeContent({ kind: "edit", items: [{ id: "x", quantity: 2 }], add: [] })).not.toBe(changeContent({ kind: "edit", items: [{ id: "x", quantity: 1 }], add: [] }))
  })

  it("the state changes when a change landed (quantities, sent, on a return, total)", () => {
    const before = order([item({ id: "a" })])
    expect(changeState(before)).toBe(changeState(order([item({ id: "a" })])))
    expect(changeState(before)).not.toBe(changeState(order([item({ id: "a", quantity: 1 })])))
    expect(changeState(before)).not.toBe(changeState({ ...before, total: 32.5 }))
    expect(changeState(before)).not.toBe(changeState(order([item({ id: "a", detail: { return_requested_quantity: 1 } })])))
    // a refund claim moves neither total nor quantity (review 2026-11-20)
    expect(changeState(before)).not.toBe(changeState(order([item({ id: "a", detail: { written_off_quantity: 1 } })])))
    expect(changeState(before)).not.toBe(changeState({ ...before, version: 2 }))
  })

  it("names the way the money goes, and below a cent there is none", () => {
    expect([moneyWay(7.5), moneyWay(-12.5), moneyWay(0), moneyWay(0.001)]).toEqual(["pay", "back", "none", "none"])
  })

  it("words the plugin's refusals itself and leaves Medusa's own messages alone", () => {
    expect(changeErrorCode(new ApiError("rejected", 400, "medusify:difference_changed"))).toBe("difference_changed")
    expect(changeErrorCode(new ApiError("rejected", 400, "medusify:change_open"))).toBe("change_open")
    expect(changeErrorCode(new ApiError("rejected", 403, "medusify:not_allowed_claim"))).toBe("not_allowed")
    expect(changeErrorCode(new ApiError("rejected", 400, "Cannot claim more items than what was ordered."))).toBeNull()
    expect(changeErrorCode(new Error("medusify:change_open"))).toBeNull()
  })
})
