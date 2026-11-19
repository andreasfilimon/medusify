import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MEDUSIFY_PUSH_MODULE } from "../../../../constants"
import { buildDashboard } from "../../../../lib/dashboard"
import type { MedusifyPushModuleService } from "../../../../modules/medusify-push"
import type { GetDashboardQuery } from "../validators"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { tz } = req.validatedQuery as GetDashboardQuery
  const service: MedusifyPushModuleService = req.scope.resolve(MEDUSIFY_PUSH_MODULE)
  // `shop_label` is the name the push titles carry; the app keys the badge number of this shop by it.
  res.json({ shop_label: service.getConfig().storeLabel, ...(await buildDashboard(req.scope, tz)) })
}
