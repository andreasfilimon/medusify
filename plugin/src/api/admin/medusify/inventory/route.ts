import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { changeStock } from "../../../../lib/stock"
import type { PostInventory } from "../validators"

/**
 * POST /admin/medusify/inventory — count (`set`), add or take away (`adjust`) or take back (`undo`) stock at one location.
 * Every request carries a key: a repeat answers with the stock as it is, without writing again (lib/stock.ts).
 */
export async function POST(req: AuthenticatedMedusaRequest<PostInventory>, res: MedusaResponse) {
  res.json(await changeStock(req.scope, req.auth_context.actor_id, req.validatedBody))
}
