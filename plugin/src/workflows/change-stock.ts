import { emitEventStep } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, InventoryLevelWorkflowEvents, MedusaError, Modules } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"

/** Marks the event of a change the app made itself (see `lib/low-stock.ts`). */
export const STOCK_SOURCE = "medusify"

export type StockChange = {
  /** The key of the request; the record of this change is stored under it (see `lib/stock.ts`). */
  key: string
  inventory_item_id: string
  location_id: string
  /** Units added (positive) or taken away (negative) from the stocked quantity. */
  delta: number
  /** What the request meant, kept in the record for "undo": adjust, set or undo. */
  mode: "adjust" | "set" | "undo"
  /** The level before the change, for the record. */
  stocked_before: number
}

type Applied = { level_id: string; stocked_after: number; operation_id: string }

type Inventory = {
  adjustInventory(itemId: string, locationId: string, adjustment: number): Promise<{ id: string; stocked_quantity: unknown }>
}

/**
 * Changes the stocked quantity by a delta (the inventory module adds in one SQL statement, so a change another process
 * makes at the same moment is not lost) and records the change under the request's key, so a repeat finds it. Medusa's own
 * `adjustInventoryLevelsStep` is not used: it takes a lock on the item id, and the route already holds that same lock.
 */
export const applyStockChangeStep = createStep(
  "medusify-apply-stock-change",
  async (change: StockChange, { container }) => {
    const inventory = container.resolve(Modules.INVENTORY) as unknown as Inventory
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    const level = await inventory.adjustInventory(change.inventory_item_id, change.location_id, change.delta)
    const stockedAfter = Number((level.stocked_quantity as { value?: unknown })?.value ?? level.stocked_quantity)
    // The record is a second write in another module, not in the same transaction. A step that throws is not compensated
    // itself (only the steps before it are). So when the record fails: if it was stored after all (the error came after the
    // commit), change and record both stand and the request goes on; if it is not there, the change is taken back, since a
    // retry with the same key would find no record and book the units a second time. If even that fails, the error says so
    // in the log, because then the stock is changed without a record.
    let operation: { id: string }
    try {
      operation = await push.createMedusifyOperations({
        key: change.key,
        kind: "stock",
        result: {
          inventory_item_id: change.inventory_item_id,
          location_id: change.location_id,
          mode: change.mode,
          delta: change.delta,
          stocked_before: change.stocked_before,
          stocked_after: stockedAfter,
        },
      })
    } catch (e) {
      const [stored] = await push.listMedusifyOperations({ key: change.key }, { take: 1 }).catch(() => [] as { id: string }[])
      if (stored) {
        operation = stored
      } else {
        try {
          await inventory.adjustInventory(change.inventory_item_id, change.location_id, -change.delta)
        } catch (back) {
          const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as unknown as { error(m: string): void }
          logger.error(
            `medusify: stock of ${change.inventory_item_id} at ${change.location_id} changed by ${change.delta} without a record (key ${change.key}); taking it back failed: ${(back as Error)?.message ?? back}`
          )
        }
        throw e
      }
    }
    return new StepResponse<Applied, { change: StockChange; operation_id: string }>(
      { level_id: level.id, stocked_after: stockedAfter, operation_id: operation.id },
      { change, operation_id: operation.id }
    )
  },
  async (done, { container }) => {
    if (!done) return
    const inventory = container.resolve(Modules.INVENTORY) as unknown as Inventory
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    await inventory.adjustInventory(done.change.inventory_item_id, done.change.location_id, -done.change.delta)
    await push.deleteMedusifyOperations([done.operation_id])
  }
)

/** An undo marks the change it took back. */
export const markUndoneStep = createStep(
  "medusify-mark-undone",
  async (input: { operation_id: string | null }, { container }) => {
    if (!input.operation_id) return new StepResponse(null)
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    await push.updateMedusifyOperations({ id: input.operation_id, undone: true })
    return new StepResponse(null, input.operation_id)
  },
  async (id, { container }) => {
    if (!id) return
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    await push.updateMedusifyOperations({ id, undone: false })
  }
)

export const refuseBelowZeroStep = createStep("medusify-refuse-below-zero", async (input: { stocked_before: number; delta: number }) => {
  if (input.stocked_before + input.delta < 0) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:below_zero")
  }
  return new StepResponse(null)
})

/**
 * Stock change from the app: the change, then the event `inventory-level.updated` (Medusa emits it from its own
 * workflows; a direct inventory call does not). `source: "medusify"` tells the low-stock subscriber that the person who made
 * the change is looking at the number: no push to anyone for it.
 */
export const changeStockWorkflow = createWorkflow(
  "medusify-change-stock",
  function (input: StockChange & { undo_of_operation_id: string | null }) {
    refuseBelowZeroStep({ stocked_before: input.stocked_before, delta: input.delta })
    const applied = applyStockChangeStep(input)
    markUndoneStep({ operation_id: input.undo_of_operation_id })
    const events = transform({ applied }, ({ applied }) => [{ id: applied.level_id, source: STOCK_SOURCE }])
    emitEventStep({ eventName: InventoryLevelWorkflowEvents.UPDATED, data: events })
    return new WorkflowResponse(applied)
  }
)
