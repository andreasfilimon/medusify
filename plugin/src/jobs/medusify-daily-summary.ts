import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendDailySummaries } from "../lib/daily-summary"

/** Every 15 minutes: devices whose daily-summary hour has come get the day's numbers (lib/daily-summary.ts). */
export default async function medusifyDailySummary(container: MedusaContainer) {
  try {
    await sendDailySummaries(container)
  } catch (error) {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as { warn(msg: string): void }
    logger.warn(`medusify: daily summary failed: ${(error as Error)?.message ?? error}`)
  }
}

export const config = {
  name: "medusify-daily-summary",
  schedule: "*/15 * * * *",
}
