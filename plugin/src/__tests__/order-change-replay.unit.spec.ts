import { MedusaError, Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import { applyChange } from "../lib/order-change"

/**
 * A repeat that finds its key still pending asks Medusa whether that change was confirmed. Only a change that is gone or
 * was taken back makes the first try void; a failed read must not (review 2026-11-20: that booked a second exchange).
 */
const stored = { order_id: "order_1", kind: "exchange", currency_code: "eur", total_before: 25, total_after: 45, difference: 20, goods_value: 12.5, state: "pending", change_id: "ordch_1" }

function container(retrieve: () => Promise<{ id: string; status: string }>) {
  const deleted: string[][] = []
  const push = {
    listMedusifyOperations: async () => [{ id: "mop_1", kind: "order_change", result: stored }],
    deleteMedusifyOperations: async (ids: string[]) => void deleted.push(ids),
    updateMedusifyOperations: async () => undefined,
  }
  const orders = { retrieveOrderChange: retrieve }
  const query = { graph: async () => { throw new Error("no new try in this test") } }
  const c = { resolve: (k: string) => (k === MEDUSIFY_PUSH_MODULE ? push : k === Modules.ORDER ? orders : k === "query" ? query : { error() {} }) }
  return { c: c as never, deleted }
}

const input = { key: "k-1", expected_difference: 20, actor: "user_1" }
const req = { kind: "exchange", return_items: [{ id: "ordli_1", quantity: 1 }], add: [{ variant_id: "v", quantity: 1 }] } as never

describe("a repeat that finds its key pending", () => {
  it("a failed read keeps the key and fails the request", async () => {
    const { c, deleted } = container(async () => { throw new Error("db timeout") })
    await expect(applyChange(c, "order_1", req, input)).rejects.toThrow("db timeout")
    expect(deleted).toEqual([])
  })
  it("a change that is still open keeps the key and answers change_open", async () => {
    const { c, deleted } = container(async () => ({ id: "ordch_1", status: "requested" }))
    await expect(applyChange(c, "order_1", req, input)).rejects.toThrow("medusify:change_open")
    expect(deleted).toEqual([])
  })
  it("a confirmed change answers from the key", async () => {
    const { c } = container(async () => ({ id: "ordch_1", status: "confirmed" }))
    await expect(applyChange(c, "order_1", req, input)).resolves.toMatchObject({ replayed: true, difference: 20 })
  })
  it("a change that is gone makes the first try void: the key goes, a new try starts", async () => {
    const { c, deleted } = container(async () => { throw new MedusaError(MedusaError.Types.NOT_FOUND, "OrderChange with id: ordch_1 was not found") })
    await expect(applyChange(c, "order_1", req, input)).rejects.toThrow("no new try in this test")
    expect(deleted).toEqual([["mop_1"]])
  })
})
