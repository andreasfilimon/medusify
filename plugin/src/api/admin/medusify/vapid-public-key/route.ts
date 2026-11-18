import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../../../constants"
import type { MedusifyPushModuleService } from "../../../../modules/medusify-push"

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const service: MedusifyPushModuleService = req.scope.resolve(MEDUSIFY_PUSH_MODULE)
  const publicKey = service.getVapidPublicKey()
  if (!publicKey) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Web push is not configured on this shop (VAPID options missing or invalid)."
    )
  }
  res.json({ public_key: publicKey })
}
