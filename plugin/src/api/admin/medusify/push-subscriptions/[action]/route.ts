import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../../../../constants"
import type { MedusifyPushModuleService } from "../../../../../modules/medusify-push"

/**
 * POST /admin/medusify/push-subscriptions/test — sends a test push to the caller's own subscriptions.
 *
 * Why `[action]` and not a folder called `test/`: `medusa plugin:build` drops every path with a segment
 * named `test` (also `integration-tests`, `unit-tests`) from the package, so a `test/route.ts` works from
 * source but silently disappears in the published plugin. `src/__tests__/build-ignore.unit.spec.ts` guards this.
 */
export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  if (req.params.action !== "test") {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Route POST ${req.path} not found`)
  }
  const service: MedusifyPushModuleService = req.scope.resolve(MEDUSIFY_PUSH_MODULE)
  if (!service.isEnabled()) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Web push is not configured on this shop (VAPID options missing or invalid)."
    )
  }
  const { storeLabel, locale } = service.getConfig()
  const result = await service.sendToUser(req.auth_context.actor_id, {
    title: `${storeLabel}: ${locale === "en" ? "Test" : "Test-Nachricht"}`,
    body: locale === "en" ? "Push notifications work." : "Push-Nachrichten funktionieren.",
    data: { url: "/medusify/" },
    tag: "medusify-test",
  })
  res.json(result)
}
