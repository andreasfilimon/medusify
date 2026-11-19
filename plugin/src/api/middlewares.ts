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
import { strictCancelMiddleware } from "../lib/cancel-guard"
import { ADMIN_ACTIONS } from "../lib/permissions"
import { ORDER_READ } from "../lib/rbac"
import { medusifyStaticMiddleware } from "../lib/static"
import {
  DeletePushSubscription,
  GetDashboardQuery,
  GetPushPreferencesQuery,
  PostPushPreference,
  PostPushSubscription,
  PostReturn,
  PostShip,
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
    // Own device settings: no right needed, so that someone who lost the order right can still switch things off.
    matcher: "/admin/medusify/push-preferences",
    method: "GET",
    middlewares: [validateAndTransformQuery(GetPushPreferencesQuery, {})],
  },
  {
    matcher: "/admin/medusify/push-preferences",
    method: "POST",
    middlewares: [validateAndTransformBody(PostPushPreference)],
  },
  {
    // Which actions the user may do (the app hides the rest). Needs only a login.
    matcher: "/admin/medusify/permissions",
    method: "GET",
    middlewares: [],
  },
  {
    // The rights Medusa itself asks for on its return routes. A refund in the same request is checked in the handler.
    matcher: "/admin/medusify/returns",
    method: "POST",
    middlewares: [authorizeIfAvailable([...ADMIN_ACTIONS.return]), validateAndTransformBody(PostReturn)],
  },
  {
    // The rights Medusa asks for on its fulfillment and shipment routes, together.
    matcher: "/admin/medusify/orders/:id/ship",
    method: "POST",
    middlewares: [authorizeIfAvailable([...ADMIN_ACTIONS.ship]), validateAndTransformBody(PostShip)],
  },
  {
    // Medusa's own right for canceling. Whether the order holds captured money, and so needs the refund right too, is
    // decided in the handler.
    matcher: "/admin/medusify/orders/:id/cancel",
    method: "POST",
    middlewares: [authorizeIfAvailable([...ADMIN_ACTIONS.cancel])],
  },
  {
    // Medusa's own cancel route refunds captured money on the order right alone. With `strictCancelRefund` the plugin asks
    // for the refund right there as well (no-op while the option is off). Runs after Medusa's own middlewares of the route.
    matcher: "/admin/orders/:id/cancel",
    method: "POST",
    middlewares: [strictCancelMiddleware],
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
