import { describe, expect, it } from "vitest"
import { shipmentsToCreate } from "../src/lib/api"
import type { Order } from "../src/lib/types"
import { order } from "./fixtures"

/**
 * A kit variant is built from inventory items. Medusa books one fulfillment item per inventory item and multiplies the
 * quantity by `required_quantity` (core-flows `create-fulfillment`), and divides it again when it registers a shipment
 * (`create-shipment`, `prepareRegisterShipmentData`). The shapes below are measured on the dev shop (order with 3 sets of a
 * kit of 2 pots + 1 cup, fulfilled in two steps).
 */
const POT = "iitem_pot"
const CUP = "iitem_cup"
const kitVariant = { inventory_items: [{ inventory_item_id: POT, required_quantity: 2 }, { inventory_item_id: CUP, required_quantity: 1 }] }

type F = NonNullable<Order["fulfillments"]>[number]
const fulfillment = (id: string, items: { line_item_id: string; inventory_item_id?: string | null; quantity: number }[], over: Partial<F> = {}): F =>
  ({ id, shipped_at: null, canceled_at: null, location_id: "sloc_a", items, ...over }) as F

const line = (id: string, quantity: number, fulfilled: number, shipped = 0, variant?: unknown) =>
  ({ id, title: id, quantity, unit_price: 1, total: quantity, detail: { fulfilled_quantity: fulfilled, shipped_quantity: shipped }, variant }) as never

const ship = (items: unknown[], fulfillments: F[]) => shipmentsToCreate({ ...order("o1"), items, fulfillments } as Order)

describe("shipmentsToCreate with an inventory kit", () => {
  it("a kit line spread over two open fulfillments: each one ships its own sets", () => {
    // 3 sets: the first fulfillment holds 1 set (pots 2, cup 1), the second 2 sets (pots 4, cups 2).
    const result = ship(
      [line("li_kit", 3, 3, 0, kitVariant)],
      [
        fulfillment("ful_1", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 1 }]),
        fulfillment("ful_2", [{ line_item_id: "li_kit", inventory_item_id: CUP, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: POT, quantity: 4 }]),
      ],
    )
    expect(result).toEqual([
      { fulfillment_id: "ful_1", items: [{ id: "li_kit", quantity: 1 }] },
      { fulfillment_id: "ful_2", items: [{ id: "li_kit", quantity: 2 }] },
    ])
  })

  it("a kit line in one fulfillment ships in whole sets", () => {
    const result = ship(
      [line("li_kit", 3, 3, 0, kitVariant)],
      [fulfillment("ful_1", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 6 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 3 }])],
    )
    expect(result).toEqual([{ fulfillment_id: "ful_1", items: [{ id: "li_kit", quantity: 3 }] }])
  })

  it("a line that is not a kit keeps its quantities over two fulfillments", () => {
    const result = ship(
      [line("li_plain", 3, 3, 0, { inventory_items: [{ inventory_item_id: "iitem_x", required_quantity: 1 }] })],
      [
        fulfillment("ful_1", [{ line_item_id: "li_plain", inventory_item_id: "iitem_x", quantity: 1 }]),
        fulfillment("ful_2", [{ line_item_id: "li_plain", inventory_item_id: "iitem_x", quantity: 2 }]),
      ],
    )
    expect(result).toEqual([
      { fulfillment_id: "ful_1", items: [{ id: "li_plain", quantity: 1 }] },
      { fulfillment_id: "ful_2", items: [{ id: "li_plain", quantity: 2 }] },
    ])
  })

  it("a kit line and a plain line in two fulfillments", () => {
    const result = ship(
      [line("li_kit", 2, 2, 0, kitVariant), line("li_plain", 1, 1)],
      [
        fulfillment("ful_1", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 1 }, { line_item_id: "li_plain", quantity: 1 }]),
        fulfillment("ful_2", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 1 }]),
      ],
    )
    expect(result).toEqual([
      { fulfillment_id: "ful_1", items: [{ id: "li_kit", quantity: 1 }, { id: "li_plain", quantity: 1 }] },
      { fulfillment_id: "ful_2", items: [{ id: "li_kit", quantity: 1 }] },
    ])
  })

  it("an earlier shipment is left out: only the open fulfillments of a partly shipped kit line go out", () => {
    // 4 sets: 1 shipped already, 1 and 2 sets wait in two open fulfillments (and one more set was never fulfilled).
    const result = ship(
      [line("li_kit", 4, 4, 1, kitVariant)],
      [
        fulfillment("ful_done", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 1 }], { shipped_at: "2026-11-16T10:00:00Z" }),
        fulfillment("ful_1", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 1 }]),
        fulfillment("ful_2", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 4 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 2 }]),
      ],
    )
    expect(result).toEqual([
      { fulfillment_id: "ful_1", items: [{ id: "li_kit", quantity: 1 }] },
      { fulfillment_id: "ful_2", items: [{ id: "li_kit", quantity: 2 }] },
    ])
  })

  it("the variant is not in the answer (a role without the right to read inventory): the ratio comes from the order's own totals", () => {
    // The shop answers 200 and drops the linked variant fields for such an admin (measured with Medusa's RBAC).
    const result = ship(
      [line("li_kit", 3, 3, 0)],
      [
        fulfillment("ful_1", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: CUP, quantity: 1 }]),
        fulfillment("ful_2", [{ line_item_id: "li_kit", inventory_item_id: CUP, quantity: 2 }, { line_item_id: "li_kit", inventory_item_id: POT, quantity: 4 }]),
      ],
    )
    expect(result).toEqual([
      { fulfillment_id: "ful_1", items: [{ id: "li_kit", quantity: 1 }] },
      { fulfillment_id: "ful_2", items: [{ id: "li_kit", quantity: 2 }] },
    ])
  })

  it("without the variant, a shipped fulfillment counts for the ratio and a canceled one does not", () => {
    // 3 sets fulfilled: 1 shipped, 2 open in two steps of 1 set; one more fulfillment (1 set) was canceled and is no part of it.
    const pot = (q: number) => ({ line_item_id: "li_kit", inventory_item_id: POT, quantity: q })
    const cup = (q: number) => ({ line_item_id: "li_kit", inventory_item_id: CUP, quantity: q })
    const result = ship(
      [line("li_kit", 4, 3, 1)],
      [
        fulfillment("ful_done", [pot(2), cup(1)], { shipped_at: "2026-11-16T10:00:00Z" }),
        fulfillment("ful_gone", [pot(2), cup(1)], { canceled_at: "2026-11-16T11:00:00Z" }),
        fulfillment("ful_1", [pot(2), cup(1)]),
        fulfillment("ful_2", [pot(2), cup(1)]),
      ],
    )
    expect(result).toEqual([
      { fulfillment_id: "ful_1", items: [{ id: "li_kit", quantity: 1 }] },
      { fulfillment_id: "ful_2", items: [{ id: "li_kit", quantity: 1 }] },
    ])
  })

  it("without the variant (deleted, or not read) the raw quantity counts, as in Medusa; nothing is dropped", () => {
    const result = ship(
      [line("li_gone", 3, 3, 0, null)],
      [
        fulfillment("ful_1", [{ line_item_id: "li_gone", inventory_item_id: POT, quantity: 1 }]),
        fulfillment("ful_2", [{ line_item_id: "li_gone", inventory_item_id: POT, quantity: 2 }]),
      ],
    )
    expect(result).toEqual([
      { fulfillment_id: "ful_1", items: [{ id: "li_gone", quantity: 1 }] },
      { fulfillment_id: "ful_2", items: [{ id: "li_gone", quantity: 2 }] },
    ])
  })

  it("an open fulfillment of a line that is shipped completely yields no shipment", () => {
    expect(ship([line("li_kit", 1, 1, 1, kitVariant)], [fulfillment("ful_1", [{ line_item_id: "li_kit", inventory_item_id: POT, quantity: 2 }])])).toEqual([])
  })
})
