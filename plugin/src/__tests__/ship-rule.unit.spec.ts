import { readFileSync } from "node:fs"
import { join } from "node:path"
import { OrderStatus } from "@medusajs/framework/utils"
import { needsShipping, OPEN_STATUSES } from "../lib/dashboard"

const rule = JSON.parse(readFileSync(join(__dirname, "../../../shared-test-data/ship-rule.json"), "utf8")) as {
  order_statuses: string[]
  payment_statuses: string[]
  fulfillment_statuses: string[]
  shippable: { order_status: string[]; payment: string[]; fulfillment: string[] }
}

/** The statuses Medusa can report, read from its own source so the table cannot silently miss a new one. */
function medusaStatuses(block: "PaymentStatus" | "FulfillmentStatus"): string[] {
  const src = readFileSync(join(__dirname, "../../node_modules/@medusajs/core-flows/dist/order/utils/aggregate-status.js"), "utf8")
  const body = src.match(new RegExp(`const ${block} = \\{([^}]*)\\}`))?.[1] ?? ""
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!)
}

describe("ship rule (shared with the PWA)", () => {
  it("the table covers exactly the statuses Medusa reports", () => {
    expect([...rule.payment_statuses].sort()).toEqual(medusaStatuses("PaymentStatus").sort())
    expect([...rule.fulfillment_statuses].sort()).toEqual(medusaStatuses("FulfillmentStatus").sort())
  })

  it("the table lists every order status Medusa has, and the plugin scans exactly the shippable ones", () => {
    expect([...rule.order_statuses].sort()).toEqual(Object.values(OrderStatus).sort())
    expect([...OPEN_STATUSES].sort()).toEqual([...rule.shippable.order_status].sort())
  })

  const cases = rule.payment_statuses.flatMap((p) =>
    rule.fulfillment_statuses.map((f) => [p, f, rule.shippable.payment.includes(p) && rule.shippable.fulfillment.includes(f)] as const),
  )

  it.each(cases)("needsShipping(%s, %s) is %s", (payment, fulfillment, expected) => {
    expect(needsShipping(payment, fulfillment)).toBe(expected)
  })

  it("a fully refunded order is never to ship, whatever is already on its way", () => {
    for (const f of rule.fulfillment_statuses) expect(needsShipping("refunded", f)).toBe(false)
  })
})
