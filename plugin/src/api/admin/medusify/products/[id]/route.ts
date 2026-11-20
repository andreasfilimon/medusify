import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getProduct } from "../../../../../lib/catalog"
import { stockAccess } from "../../../../../lib/rbac"

/** GET /admin/medusify/products/:id — one product with all variants, prices and stock per location. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const product = await getProduct(req.scope, req.params.id, await stockAccess(req))
  if (!product) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_product")
  res.json({ product })
}
