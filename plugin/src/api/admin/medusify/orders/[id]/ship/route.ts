import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { shipOrder } from "../../../../../../lib/ship"
import type { PostShip } from "../../../validators"

/**
 * POST /admin/medusify/orders/:id/ship — ship everything that is not shipped yet in one request: create the missing
 * fulfillments, then register the shipments with the tracking numbers. A carrier label written when the fulfillment was
 * created is kept. A repeat finds nothing to do and answers 200 with `nothing_to_do` (lib/ship.ts).
 */
export async function POST(req: AuthenticatedMedusaRequest<PostShip>, res: MedusaResponse) {
  const body = req.validatedBody
  const result = await shipOrder(req.scope, {
    orderId: req.params.id,
    userId: req.auth_context.actor_id,
    notify: body.notify,
    location_id: body.location_id,
    tracking_number: body.tracking_number || undefined,
    tracking_url: body.tracking_url || undefined,
    numbers: body.numbers,
  })
  res.status(200).json(result)
}
