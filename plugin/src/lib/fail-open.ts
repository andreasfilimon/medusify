import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Fail-open: a push problem must never disturb an order. Everything is caught and logged, nothing is thrown to the
 * event bus.
 */
export async function failOpen(container: MedusaContainer, what: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    try {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
      logger.error(`[medusify] ${what} failed (ignored): ${(error as Error)?.message ?? error}`)
    } catch {
      // not even logging worked — still must not throw
    }
  }
}
