import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { settleManualOrder } from "../../../../../../lib/manual-order-attempt"

type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

/**
 * GET /admin/medusify/orders/attempts/:key — did the order by hand with this key get made? The app asks after a lost
 * answer, before it lets the merchant send again. Under the same lock as the create, so a create still running is
 * waited for, not answered with "none".
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const key = String(req.params.key ?? "")
  if (key.length < 8 || key.length > 128) throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:bad_key")
  const locking = req.scope.resolve(Modules.LOCKING) as unknown as Locking
  const attempt = await locking.execute([`medusify-manual-order:${key}`], () => settleManualOrder(req.scope, key), { timeout: 60, expire: 120 })
  res.json(attempt)
}
