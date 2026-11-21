import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaModule } from "@medusajs/framework/modules-sdk"
import { Modules } from "@medusajs/framework/utils"
import { ADMIN_ACTIONS, ADMIN_ACTION_KEYS } from "../../../../lib/permissions"
import { userMay } from "../../../../lib/rbac"

/**
 * GET /admin/medusify/permissions — which of the app's actions the signed-in user may do. The app hides the others
 * instead of showing a button that ends in an error. Without Medusa's RBAC module everything is allowed; `rbac` says which
 * case it is, so the app can tell "this shop has no roles" from "your role may do everything".
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const userId = req.auth_context.actor_id
  const entries = await Promise.all(
    ADMIN_ACTION_KEYS.map(async (key) => [key, await userMay(req.scope, userId, ADMIN_ACTIONS[key])] as const)
  )
  res.json({ actions: Object.fromEntries(entries), rbac: MedusaModule.isInstalled(Modules.RBAC) })
}
