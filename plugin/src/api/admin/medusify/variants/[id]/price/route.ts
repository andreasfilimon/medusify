import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { setBasePrice } from "../../../../../../lib/price"
import type { PostPrice } from "../../../validators"

/**
 * POST /admin/medusify/variants/:id/price — set the plain price of one currency, in the main unit of the currency
 * (19.99 euro is 19.99). Other prices of the variant (other currencies, region prices, quantity tiers) stay as they are
 * (lib/price.ts). Answers with the variant's prices as they are now.
 */
export async function POST(req: AuthenticatedMedusaRequest<PostPrice>, res: MedusaResponse) {
  const { currency_code, amount } = req.validatedBody
  res.json({ prices: await setBasePrice(req.scope, req.params.id, currency_code, amount) })
}
