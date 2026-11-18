import * as http from "@medusajs/framework/http"
import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

type Policy = { resource: string; operation: string }
type Middleware = (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => unknown

/**
 * Medusa's `authorize` middleware exists from 2.22.3 on, together with RBAC. On 2.22.0 to 2.22.2 there are no roles, so
 * every admin may read every order, which is what `authorize` does anyway when the RBAC module is not installed. Calling
 * the missing export there would stop the whole backend from starting ("authorize is not a function"), so the plugin
 * falls back to a middleware that lets the request through.
 */
export function authorizeIfAvailable(policy: Policy, framework: Record<string, unknown> = http): Middleware {
  const authorize = framework.authorize
  if (typeof authorize === "function") {
    return (authorize as (p: Policy) => Middleware)(policy)
  }
  return (_req, _res, next) => next()
}
