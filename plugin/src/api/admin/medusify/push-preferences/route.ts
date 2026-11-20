import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../../../constants"
import { SWITCHABLE_KINDS, cleanDisabledKinds, cleanThreshold } from "../../../../lib/push-kinds"
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

const answer = (sub: { disabled_kinds?: unknown; low_stock_threshold?: unknown }) => ({
  kinds: toMap(sub.disabled_kinds),
  low_stock_threshold: cleanThreshold(sub.low_stock_threshold),
})

/** GET /admin/medusify/push-preferences?endpoint= — which optional push kinds this device gets, and its low-stock threshold. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { endpoint } = req.validatedQuery as unknown as GetPushPreferencesQuery
  const { subscription } = await ownSubscription(req, endpoint)
  res.json(answer(subscription))
}

type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

/**
 * POST /admin/medusify/push-preferences — switch one optional kind on or off for this device, or set its low-stock threshold.
 *
 * The list of switched-off kinds is read, changed and written back. Two switches in quick succession (two taps, or two
 * requests of a retry) would both read the old list and the second write would drop the first switch, so the whole
 * read-change-write runs under a lock per device. The lock also holds across several backend processes with Redis.
 */
export async function POST(req: AuthenticatedMedusaRequest<PostPushPreference>, res: MedusaResponse) {
  const body = req.validatedBody
  const { endpoint } = body
  const locking = req.scope.resolve(Modules.LOCKING) as unknown as Locking
  const result = await locking.execute(
    [`medusify-push-preference:${endpoint}`],
    async () => {
      const { service, subscription } = await ownSubscription(req, endpoint)
      if ("low_stock_threshold" in body) {
        await service.updatePushSubscriptions({ id: subscription.id, low_stock_threshold: body.low_stock_threshold })
        return answer({ ...subscription, low_stock_threshold: body.low_stock_threshold })
      }
      const off = new Set(cleanDisabledKinds(subscription.disabled_kinds))
      if (body.enabled) off.delete(body.kind)
      else off.add(body.kind)
      const next = cleanDisabledKinds([...off])
      await service.updatePushSubscriptions({ id: subscription.id, disabled_kinds: next })
      return answer({ ...subscription, disabled_kinds: next })
    },
    { timeout: 10, expire: 30 }
  )
  res.json(result)
}
