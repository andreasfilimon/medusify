import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import { toNumber } from "./bignum"
import { ADMIN_ACTIONS } from "./permissions"
import { userMay } from "./rbac"
import { changeStockWorkflow } from "../workflows/change-stock"

type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

export type StockLevelAnswer = {
  inventory_item_id: string
  location_id: string
  stocked: number
  reserved: number
  available: number
  /** The key was used before: nothing was written again. */
  replayed: boolean
  /** Units this request changed (0 when replayed). */
  delta: number
}

export type StockRequest =
  | { mode: "adjust"; inventory_item_id: string; location_id: string; quantity: number; idempotency_key: string }
  | { mode: "set"; inventory_item_id: string; location_id: string; quantity: number; idempotency_key: string }
  | { mode: "undo"; undo_of: string; idempotency_key: string }

type OpResult = { inventory_item_id?: string; location_id?: string; delta?: number; tombstone?: boolean }

/** A record older than this is no longer needed: the app sends a key again within minutes, not days. */
const OPERATION_KEEP_MS = 3 * 24 * 60 * 60 * 1000
const LOCK = { timeout: 30, expire: 60 }

const service = (c: MedusaContainer) => c.resolve(MEDUSIFY_PUSH_MODULE) as MedusifyPushModuleService
const lockingOf = (c: MedusaContainer) => c.resolve(Modules.LOCKING) as unknown as Locking

async function readLevel(container: MedusaContainer, itemId: string, locationId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "stocked_quantity", "reserved_quantity"],
    filters: { inventory_item_id: itemId, location_id: locationId },
  })
  const level = data[0] as { id: string; stocked_quantity?: unknown; reserved_quantity?: unknown } | undefined
  return level ? { id: level.id, stocked: toNumber(level.stocked_quantity as number), reserved: toNumber(level.reserved_quantity as number) } : null
}

async function answerOf(container: MedusaContainer, itemId: string, locationId: string, replayed: boolean, delta: number): Promise<StockLevelAnswer> {
  const level = await readLevel(container, itemId, locationId)
  if (!level) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_level")
  return { inventory_item_id: itemId, location_id: locationId, stocked: level.stocked, reserved: level.reserved, available: level.stocked - level.reserved, replayed, delta }
}

/** Removes the records nobody will ask for again. Never fails the request. */
async function sweep(container: MedusaContainer) {
  try {
    const push = service(container)
    const old = await push.listMedusifyOperations({ created_at: { $lt: new Date(Date.now() - OPERATION_KEEP_MS) } }, { take: 200 })
    if (old.length) await push.deleteMedusifyOperations(old.map((o: { id: string }) => o.id))
  } catch {
    /* housekeeping only */
  }
}

/**
 * One stock change of the app: count (`set`), add or take away (`adjust`) or take back an earlier change (`undo`).
 *
 * The whole request runs under the same lock Medusa's own inventory adjustments take (the item id), so a fulfillment and
 * a scan do not interleave. The key makes it safe to send again: a repeat finds the record and answers with the stock as
 * it is now, without writing. An undo reverses exactly the units the original request changed, and only once. An undo for
 * a request that never landed leaves a marker under the original key, so the request that arrives late changes nothing.
 */
export async function changeStock(container: MedusaContainer, userId: string, req: StockRequest): Promise<StockLevelAnswer> {
  const push = service(container)
  let original: { id: string; undone: boolean; result: OpResult } | null = null
  let itemId: string
  let locationId: string
  if (req.mode === "undo") {
    const [row] = await push.listMedusifyOperations({ key: req.undo_of }, { take: 1 })
    original = row ? { id: row.id, undone: !!row.undone, result: (row.result ?? {}) as OpResult } : null
    if (!original?.result.inventory_item_id || !original.result.location_id) {
      // Never landed: keep the original key from being used later.
      await tombstone(push, req.undo_of)
      throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:nothing_to_undo")
    }
    itemId = original.result.inventory_item_id
    locationId = original.result.location_id
  } else {
    itemId = req.inventory_item_id
    locationId = req.location_id
  }

  const outcome = await lockingOf(container).execute(
    [itemId],
    async () => {
      const [again] = await push.listMedusifyOperations({ key: req.idempotency_key }, { take: 1 })
      if (again) return answerOf(container, itemId, locationId, true, 0)

      let level = await readLevel(container, itemId, locationId)
      if (!level) {
        if (!(await userMay(container, userId, ADMIN_ACTIONS.stock_new_level))) throw new MedusaError(MedusaError.Types.FORBIDDEN, "Forbidden")
        await createInventoryLevelsWorkflow(container).run({
          input: { inventory_levels: [{ inventory_item_id: itemId, location_id: locationId, stocked_quantity: 0 }] },
        })
        level = await readLevel(container, itemId, locationId)
        if (!level) throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "medusify:no_level")
      }

      let delta: number
      let undoOf: string | null = null
      if (req.mode === "undo") {
        // Read again under the lock: two undos with different keys may both have seen "not undone" before it.
        const [fresh] = await push.listMedusifyOperations({ id: original!.id }, { take: 1 })
        if (!fresh || fresh.undone) return answerOf(container, itemId, locationId, true, 0)
        delta = -Number(original!.result.delta ?? 0)
        undoOf = original!.id
      } else if (req.mode === "set") {
        delta = req.quantity - level.stocked
      } else {
        delta = req.quantity
      }
      if (delta === 0) {
        // Nothing to write; keep the key so a repeat is a repeat.
        await push.createMedusifyOperations({ key: req.idempotency_key, kind: "stock", result: { inventory_item_id: itemId, location_id: locationId, mode: req.mode, delta: 0 } })
        return answerOf(container, itemId, locationId, false, 0)
      }
      await changeStockWorkflow(container).run({
        input: {
          key: req.idempotency_key,
          inventory_item_id: itemId,
          location_id: locationId,
          delta,
          mode: req.mode,
          stocked_before: level.stocked,
          undo_of_operation_id: undoOf,
        },
      })
      return answerOf(container, itemId, locationId, false, delta)
    },
    LOCK
  )
  void sweep(container)
  return outcome
}

async function tombstone(push: MedusifyPushModuleService, key: string) {
  try {
    await push.createMedusifyOperations({ key, kind: "stock", undone: true, result: { tombstone: true, delta: 0 } })
  } catch {
    /* the key exists already: a concurrent request landed first, which is the case the marker is for */
  }
}
