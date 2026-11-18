import {
  type MedusaNextFunction,
  type MiddlewareRoute,
  type MedusaRequest,
  type MedusaResponse,
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"
import { MEDUSIFY_PWA_BASE_PATH } from "../constants"
import { authorizeIfAvailable } from "../lib/authorize-compat"
import { ORDER_READ } from "../lib/rbac"
import { medusifyStaticMiddleware } from "../lib/static"
import {
  DeletePushSubscription,
  GetDashboardQuery,
  PostPushSubscription,
} from "./admin/medusify/validators"

/**
 * Some HTTP clients drop the body of DELETE requests. Accept `?endpoint=` as well and move it into
 * the body before validation.
 */
function endpointFromQuery(req: MedusaRequest, _res: MedusaResponse, next: MedusaNextFunction) {
  const body = (req.body ?? {}) as Record<string, unknown>
  if (!body.endpoint && typeof req.query.endpoint === "string") {
    req.body = { ...body, endpoint: req.query.endpoint }
  }
  next()
}

// Admin routes (/admin/*) get Medusa's standard admin authentication automatically
// (session or bearer JWT of an admin user — tokens only exist after a completed MFA login).
// DELETE of a push subscription stays open on purpose: someone who lost the right to read orders
// must still be able to remove their own device.
// Typed explicitly: with `authorize` in the list, TypeScript 5.9 crashes ("No error for last overload signature")
// while inferring the argument of defineMiddlewares.
const routes: MiddlewareRoute[] = [
  {
    // Global (no `method`) ⇒ app.use(prefix): matches /medusify and everything below it.
    matcher: MEDUSIFY_PWA_BASE_PATH,
    middlewares: [medusifyStaticMiddleware],
  },
  {
    matcher: "/admin/medusify/push-subscriptions",
    method: "POST",
    // Only users who may read orders get push messages about them. No-op without Medusa's RBAC module and before 2.22.3.
    middlewares: [authorizeIfAvailable(ORDER_READ), validateAndTransformBody(PostPushSubscription)],
  },
  {
    matcher: "/admin/medusify/push-subscriptions",
    method: "DELETE",
    middlewares: [endpointFromQuery, validateAndTransformBody(DeletePushSubscription)],
  },
  {
    matcher: "/admin/medusify/dashboard",
    method: "GET",
    // Revenue and orders: the same right Medusa asks for on /admin/orders. No-op without Medusa's RBAC module.
    // `authorize` has to come before the query middleware (it records the policies the query config reads).
    middlewares: [authorizeIfAvailable(ORDER_READ), validateAndTransformQuery(GetDashboardQuery, {})],
  },
]

export default defineMiddlewares({ routes })
