import type { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import type { ChangeRequest } from "../../../../../../lib/order-change"
import { ADMIN_ACTIONS } from "../../../../../../lib/permissions"
import { userMay } from "../../../../../../lib/rbac"
import type { OrderChangeBody } from "../../../validators"

/** The right for the kind of change: the body decides which, so it is checked here and not in the middleware. */
export async function refuseWithoutRight(container: MedusaContainer, actor: string, kind: OrderChangeBody["kind"]) {
  const right = kind === "edit" ? ADMIN_ACTIONS.order_edit : kind === "exchange" ? ADMIN_ACTIONS.exchange : ADMIN_ACTIONS.claim
  if (!(await userMay(container, actor, right))) throw new MedusaError(MedusaError.Types.FORBIDDEN, `medusify:not_allowed_${kind}`)
}

export function toRequest(body: OrderChangeBody): ChangeRequest {
  if (body.kind === "edit") return { kind: "edit", items: body.items, add: body.add, note: body.note ?? null }
  if (body.kind === "exchange") return { kind: "exchange", return_items: body.return_items, add: body.add, location_id: body.location_id ?? null, note: body.note ?? null }
  return { kind: "claim", type: body.type, items: body.items, add: body.type === "replace" ? body.add : [], note: body.note ?? null }
}

export type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

/** One change of an order at a time: the preview begins and takes back a change too. */
export const orderLock = (orderId: string) => [`medusify-order-change:${orderId}`]
