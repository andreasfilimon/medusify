import type { LoaderOptions } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { resolveOptions } from "../options"
import type { MedusifyPushOptions } from "../types"

/**
 * Logs configuration problems at startup. Deliberately does NOT throw: a typo in the
 * push config must not keep the merchant's whole shop from starting. Push is then off,
 * dashboard and PWA keep working.
 */
export default async function validateOptionsLoader({
  container,
  options,
}: LoaderOptions<MedusifyPushOptions>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const resolved = resolveOptions(options)
  if (resolved.problems.length) {
    logger.warn(
      `[medusify] push is ${resolved.enabled ? "on" : "OFF"}: ${resolved.problems.join("; ")}. ` +
        "Generate keys with `npx web-push generate-vapid-keys`."
    )
  } else {
    logger.info("[medusify] web push configured")
  }
}
