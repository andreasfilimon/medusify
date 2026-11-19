import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../../../constants"
import { SWITCHABLE_KINDS, cleanDisabledKinds } from "../../../../lib/push-kinds"
import type { MedusifyPushModuleService } from "../../../../modules/medusify-push"
import type { GetPushPreferencesQuery, PostPushPreference } from "../validators"

/** The caller's own subscription of this device; someone else's endpoint looks like a missing one. */
async function ownSubscription(req: AuthenticatedMedusaRequest, endpoint: string) {
  const service: MedusifyPushModuleService = req.scope.resolve(MEDUSIFY_PUSH_MODULE)
  const [subscription] = await service.listPushSubscriptions({ endpoint }, { take: 1 })
  if (!subscription || subscription.user_id !== req.auth_context.actor_id) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "This device has no push subscription in this shop.")
  }
  return { service, subscription }
}

const toMap = (disabled: unknown) => {
  const off = cleanDisabledKinds(disabled)
  return Object.fromEntries(SWITCHABLE_KINDS.map((kind) => [kind, !off.includes(kind)]))
}

/** GET /admin/medusify/push-preferences?endpoint= — which optional push kinds this device gets. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { endpoint } = req.validatedQuery as unknown as GetPushPreferencesQuery
  const { subscription } = await ownSubscription(req, endpoint)
  res.json({ kinds: toMap(subscription.disabled_kinds) })
}

type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

/**
 * POST /admin/medusify/push-preferences — switch one optional kind on or off for this device.
 *
 * The list of switched-off kinds is read, changed and written back. Two switches in quick succession (two taps, or two
 * requests of a retry) would both read the old list and the second write would drop the first switch, so the whole
 * read-change-write runs under a lock per device. The lock also holds across several backend processes with Redis.
 */
export async function POST(req: AuthenticatedMedusaRequest<PostPushPreference>, res: MedusaResponse) {
  const { endpoint, kind, enabled } = req.validatedBody
  const locking = req.scope.resolve(Modules.LOCKING) as unknown as Locking
  const kinds = await locking.execute(
    [`medusify-push-preference:${endpoint}`],
    async () => {
      const { service, subscription } = await ownSubscription(req, endpoint)
      const off = new Set(cleanDisabledKinds(subscription.disabled_kinds))
      if (enabled) off.delete(kind)
      else off.add(kind)
      const next = cleanDisabledKinds([...off])
      await service.updatePushSubscriptions({ id: subscription.id, disabled_kinds: next })
      return toMap(next)
    },
    { timeout: 10, expire: 30 }
  )
  res.json({ kinds })
}
