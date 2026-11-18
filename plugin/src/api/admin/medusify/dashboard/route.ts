import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildDashboard } from "../../../../lib/dashboard"
import type { GetDashboardQuery } from "../validators"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { tz } = req.validatedQuery as GetDashboardQuery
  res.json(await buildDashboard(req.scope, tz))
}
