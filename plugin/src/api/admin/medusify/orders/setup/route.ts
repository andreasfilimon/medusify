import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { orderSetup } from "../../../../../workflows/manual-order"

/** GET /admin/medusify/orders/setup — regions and flat shipping options with their prices, for an order taken by hand. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json(await orderSetup(req.scope))
}
