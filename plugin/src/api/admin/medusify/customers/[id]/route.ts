import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { getCustomer } from "../../../../../lib/customers"

/** GET /admin/medusify/customers/:id — the customer with addresses, groups, order count, spend and last order. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  res.json({ customer: await getCustomer(req.scope, req.params.id) })
}
