import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { listCustomers } from "../../../../lib/customers"
import type { GetCustomersQuery } from "../validators"

/** GET /admin/medusify/customers?q=&offset=&limit= — customers, newest first, each with order count, spend and last order. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = req.validatedQuery as unknown as GetCustomersQuery
  const page = await listCustomers(req.scope, { q: query.q, offset: query.offset, limit: query.limit })
  res.json({ ...page, offset: query.offset, limit: query.limit })
}
