import { hasPermission } from "@medusajs/framework"
import * as http from "@medusajs/framework/http"
import { MedusaModule } from "@medusajs/framework/modules-sdk"
import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules, PolicyOperation } from "@medusajs/framework/utils"
import { ADMIN_ACTIONS, type Policy } from "./permissions"

type ResolveRoles = (input: { authContext: { actor_id: string; actor_type: string }; container: MedusaContainer }) => Promise<unknown>

/**
 * `resolveRoles` exists from Medusa 2.22.3 on, with RBAC. A named import would not compile on 2.22.0 to 2.22.2, so it is
 * read from the namespace (the same reason as in `authorizeIfAvailable`). It is only called when the RBAC module is installed.
 */
const resolveRoles = (http as unknown as { resolveRoles?: ResolveRoles }).resolveRoles

/**
 * The right that Medusa itself asks for on every admin order route (`/admin/orders`, medusa/dist/api/admin/orders/
 * middlewares.js: `authorize({ resource: "order", operation: "read" })`). The dashboard shows revenue and orders and the
 * push shows new orders, so both need the same right, not just a login.
 */
export const ORDER_READ = { resource: "order", operation: PolicyOperation.read } as const

/**
 * Whether the admin user holds all of these policies. Medusa's RBAC is a licensed module: without it every admin may do
 * everything (`authorize` is a no-op then, and so is this) and nothing changes. With it, the user needs a role that
 * grants every policy (or a wildcard). Any error while looking this up counts as "no": better no push and no button
 * than data or an action for someone whose right could not be checked.
 */
export async function userMay(container: MedusaContainer, userId: string, policies: readonly Policy[]): Promise<boolean> {
  if (!MedusaModule.isInstalled(Modules.RBAC)) return true
  try {
    if (!resolveRoles) return false
    const roles = await resolveRoles({
      authContext: { actor_id: userId, actor_type: "user" },
      container,
    })
    return await hasPermission({ roles: roles as never, actions: [...policies], container })
  } catch {
    return false
  }
}

/** Whether the admin user may read orders: the right behind the order push and the dashboard. */
export function canReadOrders(container: MedusaContainer, userId: string): Promise<boolean> {
  return userMay(container, userId, [ORDER_READ])
}

/** Whether the catalog answer for this request may carry stock (Medusa guards stock with `inventory_item:read`). */
export async function stockAccess(req: { scope: MedusaContainer; auth_context: { actor_id: string } }): Promise<{ stock: boolean }> {
  return { stock: await userMay(req.scope, req.auth_context.actor_id, ADMIN_ACTIONS.stock_read) }
}
