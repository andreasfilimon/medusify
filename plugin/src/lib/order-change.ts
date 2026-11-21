import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import {
  beginClaimOrderWorkflow,
  beginExchangeOrderWorkflow,
  beginOrderEditOrderWorkflow,
  cancelBeginOrderClaimWorkflow,
  cancelBeginOrderEditWorkflow,
  cancelBeginOrderExchangeWorkflow,
  confirmClaimRequestWorkflow,
  confirmExchangeRequestWorkflow,
  confirmOrderEditRequestWorkflow,
  orderClaimAddNewItemWorkflow,
  orderClaimItemWorkflow,
  orderEditAddNewItemWorkflow,
  orderEditUpdateItemQuantityWorkflow,
  orderExchangeAddNewItemWorkflow,
  orderExchangeRequestItemReturnWorkflow,
  requestOrderEditRequestWorkflow,
} from "@medusajs/medusa/core-flows"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import { toNumber, type Amount } from "./bignum"

type Line = { id: string; quantity: number }
type NewLine = { variant_id: string; quantity: number }

/**
 * What the app may change on an order. The three kinds are Medusa's own order changes:
 * - edit: new quantities of existing lines (0 removes the line) and new lines, before anything is shipped of them;
 * - exchange: lines that come back plus new lines that go out, in one change;
 * - claim: lines that arrived broken or wrong, refunded (`refund`) or sent again (`replace`, optionally other variants).
 */
export type ChangeRequest =
  | { kind: "edit"; items: Line[]; add: NewLine[]; note?: string | null }
  | { kind: "exchange"; return_items: Line[]; add: NewLine[]; location_id?: string | null; note?: string | null }
  | { kind: "claim"; type: "refund" | "replace"; items: (Line & { reason: ClaimReason })[]; add: NewLine[]; note?: string | null }

export type ClaimReason = "missing_item" | "wrong_item" | "production_failure" | "other"

/**
 * The money of a change: the order total before and after, and what is open to pay (+) or to give back (−) once it is
 * confirmed. `goods_value` is what the lines that come back (exchange) or are claimed are worth: Medusa counts the goods of
 * an exchange only when the return is received, and a claim does not move money by itself (the refund is the merchant's).
 */
export type ChangeMoney = { currency_code: string; total_before: number; total_after: number; difference: number; goods_value: number }

type Opened = { kind: ChangeRequest["kind"]; change_id: string; exchange_id?: string; claim_id?: string }

type OrderModule = {
  listOrderChanges(filters: Record<string, unknown>, config?: Record<string, unknown>): Promise<{ id: string; status: string; change_type?: string | null }[]>
  retrieveOrderChange(id: string): Promise<{ id: string; status: string }>
  previewOrderChange(orderId: string): Promise<{ total?: Amount; summary?: { pending_difference?: Amount; current_order_total?: Amount }; items?: { id: string; quantity?: Amount; total?: Amount }[] }>
}

const OPEN = ["pending", "requested"]

/** One open change at a time, as in Medusa: one begun in the Medusa admin (or left by a crash) blocks the app's. */
async function refuseOpenChange(container: MedusaContainer, orderId: string) {
  const orders = container.resolve(Modules.ORDER) as unknown as OrderModule
  const open = await orders.listOrderChanges({ order_id: orderId, status: OPEN }, { take: 1 })
  if (open.length) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:change_open")
}

type Before = { currency_code: string; total: number; pending: number; status: string }
type PricedLine = { id: string; quantity: number; total: number }

async function orderMoney(container: MedusaContainer, orderId: string): Promise<Before> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "status", "currency_code", "summary", "items.*", "shipping_methods.*"], filters: { id: orderId } })
  const order = data[0] as
    | { status?: string; currency_code?: string; summary?: { current_order_total?: Amount; pending_difference?: Amount } }
    | undefined
  if (!order) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_order")
  return {
    currency_code: String(order.currency_code ?? "").toLowerCase(),
    total: toNumber(order.summary?.current_order_total),
    pending: toNumber(order.summary?.pending_difference),
    status: String(order.status ?? ""),
  }
}

/** Begins the change and adds its actions. On any failure the begun change is cancelled again before the error goes on. */
async function open(container: MedusaContainer, orderId: string, req: ChangeRequest, actor: string): Promise<Opened> {
  let opened: Opened | null = null
  try {
    if (req.kind === "edit") {
      const { result } = await beginOrderEditOrderWorkflow(container).run({ input: { order_id: orderId, created_by: actor, internal_note: req.note ?? undefined } })
      opened = { kind: "edit", change_id: (result as { id: string }).id }
      if (req.items.length) await orderEditUpdateItemQuantityWorkflow(container).run({ input: { order_id: orderId, items: req.items } })
      if (req.add.length) await orderEditAddNewItemWorkflow(container).run({ input: { order_id: orderId, items: req.add } })
    } else if (req.kind === "exchange") {
      const { result } = await beginExchangeOrderWorkflow(container).run({ input: { order_id: orderId, created_by: actor, internal_note: req.note ?? undefined } })
      const change = result as { id: string; exchange_id: string }
      opened = { kind: "exchange", change_id: change.id, exchange_id: change.exchange_id }
      await orderExchangeRequestItemReturnWorkflow(container).run({
        input: { exchange_id: change.exchange_id, items: req.return_items, ...(req.location_id ? { location_id: req.location_id } : {}) } as never,
      })
      await orderExchangeAddNewItemWorkflow(container).run({ input: { exchange_id: change.exchange_id, items: req.add } as never })
    } else {
      const { result } = await beginClaimOrderWorkflow(container).run({ input: { order_id: orderId, type: req.type, created_by: actor, internal_note: req.note ?? undefined } as never })
      const change = result as { id: string; claim_id: string }
      opened = { kind: "claim", change_id: change.id, claim_id: change.claim_id }
      await orderClaimItemWorkflow(container).run({ input: { claim_id: change.claim_id, items: req.items } as never })
      if (req.type === "replace" && req.add.length) await orderClaimAddNewItemWorkflow(container).run({ input: { claim_id: change.claim_id, items: req.add } as never })
    }
    return opened
  } catch (e) {
    if (opened) await discard(container, orderId, opened)
    throw e
  }
}

/** Takes a begun change back (Medusa's cancel of a begun edit, exchange or claim). Logs and goes on if that fails too. */
async function discard(container: MedusaContainer, orderId: string, opened: Opened) {
  try {
    if (opened.kind === "edit") await cancelBeginOrderEditWorkflow(container).run({ input: { order_id: orderId } })
    else if (opened.kind === "exchange") await cancelBeginOrderExchangeWorkflow(container).run({ input: { exchange_id: opened.exchange_id! } })
    else await cancelBeginOrderClaimWorkflow(container).run({ input: { claim_id: opened.claim_id! } })
  } catch (e) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as unknown as { error(m: string): void }
    logger.error(`medusify: the ${opened.kind} ${opened.change_id} of order ${orderId} could not be taken back: ${(e as Error)?.message ?? e}`)
  }
}

/**
 * The money after the change, as Medusa's preview of the open change prices it. The difference is how much more (or less)
 * is open to pay than before: a claim that refunds does not change the order total, but what is owed to the customer.
 */
async function preview(container: MedusaContainer, orderId: string, before: Before, req: ChangeRequest): Promise<ChangeMoney> {
  const orders = container.resolve(Modules.ORDER) as unknown as OrderModule
  const p = await orders.previewOrderChange(orderId)
  const after = toNumber(p.summary?.current_order_total ?? p.total)
  const pending = toNumber(p.summary?.pending_difference)
  return {
    currency_code: before.currency_code,
    total_before: before.total,
    total_after: after,
    difference: cents(pending - before.pending),
    // the preview's lines carry Medusa's computed totals (a plain query of the order does not)
    goods_value: goodsValue({ items: (p.items ?? []).map((i) => ({ id: i.id, quantity: toNumber(i.quantity), total: toNumber(i.total) })) }, req),
  }
}

const cents = (n: number) => Math.round(n * 100) / 100

/** What the lines that come back or are claimed are worth: their share of the line total (discounts and tax included). */
export function goodsValue(before: { items: PricedLine[] }, req: ChangeRequest): number {
  const back = req.kind === "exchange" ? req.return_items : req.kind === "claim" ? req.items : []
  return cents(
    back.reduce((sum, b) => {
      const line = before.items.find((i) => i.id === b.id)
      return line && line.quantity > 0 ? sum + (line.total / line.quantity) * b.quantity : sum
    }, 0)
  )
}

async function confirm(container: MedusaContainer, orderId: string, opened: Opened, actor: string) {
  if (opened.kind === "edit") {
    await requestOrderEditRequestWorkflow(container).run({ input: { order_id: orderId, requested_by: actor } })
    await confirmOrderEditRequestWorkflow(container).run({ input: { order_id: orderId, confirmed_by: actor } })
  } else if (opened.kind === "exchange") {
    await confirmExchangeRequestWorkflow(container).run({ input: { exchange_id: opened.exchange_id!, confirmed_by: actor } })
  } else {
    await confirmClaimRequestWorkflow(container).run({ input: { claim_id: opened.claim_id!, confirmed_by: actor } })
  }
}

function refuseClosed(status: string) {
  if (status === "canceled" || status === "draft" || status === "archived") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:order_closed")
}

/**
 * What the change would do to the money, without changing anything: the change is begun, priced by Medusa and taken back.
 * The app shows this before the merchant confirms.
 */
export async function previewChange(container: MedusaContainer, orderId: string, req: ChangeRequest, actor: string): Promise<ChangeMoney> {
  const before = await orderMoney(container, orderId)
  refuseClosed(before.status)
  await refuseOpenChange(container, orderId)
  const opened = await open(container, orderId, req, actor)
  try {
    return await preview(container, orderId, before, req)
  } finally {
    await discard(container, orderId, opened)
  }
}

export type ChangeResult = ChangeMoney & { kind: ChangeRequest["kind"]; order_id: string; replayed: boolean }

/** Two amounts that differ by less than a cent are the same. */
const sameMoney = (a: number, b: number) => Math.abs(a - b) < 0.005

/** What is stored under the key: the answer, and until the change is confirmed the Medusa change it belongs to. */
type Stored = Omit<ChangeResult, "replayed"> & { state: "pending" | "done"; change_id: string }

const logError = (container: MedusaContainer, m: string) =>
  (container.resolve(ContainerRegistrationKeys.LOGGER) as unknown as { error(m: string): void }).error(m)

/**
 * Makes the change. `expected_difference` is what the merchant saw and confirmed: when the price of the change is now
 * different (a price or the order changed in between), nothing is changed and the new numbers come back with
 * `medusify:difference_changed`.
 *
 * The key is stored before the change is confirmed, with the id of Medusa's change, and marked done after. A repeat of the
 * key answers from the stored result; one that finds it still pending (the first try stopped between the two) asks Medusa
 * whether that change was confirmed: then it answers with it, otherwise the first try is void and this one runs. So a lost
 * answer never makes the change twice, also when writing the key fails.
 */
export async function applyChange(
  container: MedusaContainer,
  orderId: string,
  req: ChangeRequest,
  input: { key: string; expected_difference: number; actor: string }
): Promise<ChangeResult> {
  const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
  const [again] = await push.listMedusifyOperations({ key: input.key }, { take: 1 })
  if (again) {
    const stored = again.result as Stored
    if (again.kind !== "order_change" || stored.order_id !== orderId) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:key_reused")
    const { state, change_id, ...answer } = stored
    if (state !== "pending") return { ...answer, replayed: true }
    const orders = container.resolve(Modules.ORDER) as unknown as OrderModule
    // Only a change that is gone, or was taken back, makes the first try void. A read that fails says nothing: then the
    // request fails too, and the key stays for the next repeat.
    const change = await orders.retrieveOrderChange(change_id).catch((e: unknown) => {
      if (e instanceof MedusaError && e.type === MedusaError.Types.NOT_FOUND) return null
      throw e
    })
    if (change?.status === "confirmed") {
      await push.updateMedusifyOperations({ id: again.id, result: { ...stored, state: "done" } }).catch(() => undefined)
      return { ...answer, replayed: true }
    }
    // still open: the first try stopped between opening and confirming; Medusa holds its change until it is taken back
    if (change && change.status !== "canceled" && change.status !== "declined") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:change_open")
    await push.deleteMedusifyOperations([again.id])
  }

  const before = await orderMoney(container, orderId)
  refuseClosed(before.status)
  await refuseOpenChange(container, orderId)
  const opened = await open(container, orderId, req, input.actor)
  let record: { id: string } | null = null
  let result: Omit<ChangeResult, "replayed">
  try {
    const money = await preview(container, orderId, before, req)
    if (!sameMoney(money.difference, input.expected_difference)) {
      throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:difference_changed")
    }
    result = { ...money, kind: req.kind, order_id: orderId }
    const pending: Stored = { ...result, state: "pending", change_id: opened.change_id }
    record = await push.createMedusifyOperations({ key: input.key, kind: "order_change", result: pending })
    await confirm(container, orderId, opened, input.actor)
  } catch (e) {
    // a confirm that failed half-way leaves the change open in Medusa: take it back so the order can be changed again
    await discard(container, orderId, opened)
    if (record) await push.deleteMedusifyOperations([record.id]).catch((err) => logError(container, `medusify: key ${input.key} of a failed change stays pending: ${err?.message ?? err}`))
    throw e
  }
  // a failure here leaves the key pending; a repeat then finds the change confirmed and answers with it
  await push
    .updateMedusifyOperations({ id: record.id, result: { ...result, state: "done", change_id: opened.change_id } })
    .catch((e) => logError(container, `medusify: the ${req.kind} of order ${orderId} is made, its key ${input.key} stays pending: ${e?.message ?? e}`))
  return { ...result, replayed: false }
}
