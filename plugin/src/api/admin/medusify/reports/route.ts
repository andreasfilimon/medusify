import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { buildReport } from "../../../../lib/report"
import type { GetReportQuery } from "../validators"

/**
 * GET /admin/medusify/reports?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Europe/Vienna — orders, revenue and average order value
 * per currency, units and returned units, for the period and the one of the same length right before it, and the
 * products with the most units sold. Read only.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { from, to, tz } = req.validatedQuery as GetReportQuery
  res.json(await buildReport(req.scope, { from, to, tz }))
}
