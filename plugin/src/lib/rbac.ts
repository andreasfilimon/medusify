import { hasPermission } from "@medusajs/framework"
import { resolveRoles } from "@medusajs/framework/http"
import { MedusaModule } from "@medusajs/framework/modules-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules, PolicyOperation } from "@medusajs/framework/utils"

/**
 * The right that Medusa itself asks for on every admin order route (`/admin/orders`, medusa/dist/api/admin/orders/
 * middlewares.js: `authorize({ resource: "order", operation: "read" })`). The dashboard shows revenue and orders and the
 * push shows new orders, so both need the same right, not just a login.
 */
export const ORDER_READ = { resource: "order", operation: PolicyOperation.read } as const

/**
 * Whether the admin user may read orders. Medusa's RBAC is a licensed module: without it every admin may read
 * everything (`authorize` is a no-op then, and so is this) and nothing changes. With it, the user needs a role that
 * grants `order:read` (or a wildcard). Any error while looking this up counts as "no": better no push than a push of
 * order data to someone whose right could not be checked.
 */
export async function canReadOrders(container: MedusaContainer, userId: string): Promise<boolean> {
  if (!MedusaModule.isInstalled(Modules.RBAC)) return true
  try {
    const roles = await resolveRoles({
      authContext: { actor_id: userId, actor_type: "user" },
      container,
    })
    return await hasPermission({ roles, actions: ORDER_READ, container })
  } catch {
    return false
  }
}
