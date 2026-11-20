import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { lookupVariants } from "../../../../../lib/catalog"
import { stockAccess } from "../../../../../lib/rbac"
import type { GetLookupQuery } from "../../validators"

/** GET /admin/medusify/variants/lookup?code= — the variants whose barcode, SKU, EAN or UPC is the scanned code, best fit first. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { code } = req.validatedQuery as unknown as GetLookupQuery
  res.json({ matches: await lookupVariants(req.scope, code, await stockAccess(req)) })
}
