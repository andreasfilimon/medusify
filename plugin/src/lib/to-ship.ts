import type { MedusaContainer } from "@medusajs/framework/types"
import { countToShip } from "./dashboard"

/**
 * The number for the app icon: orders still to ship in this shop. A push must never fail because of it, so a failed
 * count gives null and the push goes out without a number (the app then keeps the one it has).
 */
export async function countToShipSafe(container: MedusaContainer): Promise<number | null> {
  try {
    return await countToShip(container)
  } catch {
    return null
  }
}
