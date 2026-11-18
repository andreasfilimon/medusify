import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { MedusaModule } from "@medusajs/framework/modules-sdk"
import { Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import orderPlacedPushHandler from "../../src/subscribers/order-placed-push"
import { createAdmin, sub } from "../helpers/admin"
import { createDemoOrder, createRegion } from "../helpers/orders"
import { useThrowAwayRbacLicense } from "../helpers/rbac-license"

// Must run before the runner loads medusa-config.ts: it adds the licensed RBAC module only when this is set.
useThrowAwayRbacLicense()

jest.setTimeout(120 * 1000)

const sendNotification = jest.fn()
jest.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: jest.fn(),
}))

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("medusify with Medusa RBAC switched on", () => {
      const rbac = () => getContainer().resolve(Modules.RBAC) as any

      /** A role that carries exactly the given policies (resource:operation), assigned to the user. */
      async function giveRole(userId: string, name: string, keys: string[]) {
        const role = await rbac().createRbacRoles({ name })
        for (const key of keys) {
          const [resource, operation] = key.split(":")
          const [policy] = await rbac().listRbacPolicies({ resource, operation })
          if (!policy) throw new Error(`policy ${key} does not exist`)
          await rbac().createRbacRolePolicies({ role_id: role.id, policy_id: policy.id })
        }
        await rbac().createRbacRoleAssignments({ role_id: role.id, reference: "user", reference_id: userId })
      }

      let reader: Awaited<ReturnType<typeof createAdmin>>
      let noOrders: Awaited<ReturnType<typeof createAdmin>>
      let noRole: Awaited<ReturnType<typeof createAdmin>>

      beforeEach(async () => {
        sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
        reader = await createAdmin(getContainer(), "reader@example.invalid")
        noOrders = await createAdmin(getContainer(), "noorders@example.invalid")
        noRole = await createAdmin(getContainer(), "norole@example.invalid")
        // roles first, before any request: Medusa caches role lookups for 60 s
        await giveRole(reader.userId, "orders-reader", ["order:read"])
        await giveRole(noOrders.userId, "products-only", ["product:read"])
      })

      it("the RBAC module is really loaded (otherwise every test below proves nothing)", () => {
        expect(MedusaModule.isInstalled(Modules.RBAC)).toBe(true)
      })

      it("the dashboard needs the right to read orders", async () => {
        const ok = await api.get("/admin/medusify/dashboard", { headers: reader.headers })
        expect(ok.status).toBe(200)
        for (const who of [noOrders, noRole]) {
          await expect(api.get("/admin/medusify/dashboard", { headers: who.headers })).rejects.toMatchObject({
            response: { status: 403 },
          })
        }
      })

      it("medusa's own order list agrees with that (same rule)", async () => {
        expect((await api.get("/admin/orders", { headers: reader.headers })).status).toBe(200)
        await expect(api.get("/admin/orders", { headers: noOrders.headers })).rejects.toMatchObject({
          response: { status: 403 },
        })
      })

      it("a push subscription can only be created with the right to read orders", async () => {
        const ok = await api.post("/admin/medusify/push-subscriptions", sub(1), { headers: reader.headers })
        expect(ok.status).toBe(201)
        for (const [n, who] of [[2, noOrders], [3, noRole]] as const) {
          await expect(api.post("/admin/medusify/push-subscriptions", sub(n), { headers: who.headers })).rejects.toMatchObject({
            response: { status: 403 },
          })
        }
        const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
        expect(await service.listPushSubscriptions({}, { take: null })).toHaveLength(1)
      })

      it("a subscription can always be removed, also by someone without the right to read orders", async () => {
        const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
        // made while the user still had the right, the role was changed since
        await service.createPushSubscriptions({ endpoint: sub(5).endpoint, p256dh: sub(5).keys.p256dh, auth: sub(5).keys.auth, user_id: noOrders.userId })
        const res = await api.delete("/admin/medusify/push-subscriptions", {
          headers: noOrders.headers,
          data: { endpoint: sub(5).endpoint },
        })
        expect(res.data).toEqual({ deleted: 1 })
        expect(await service.listPushSubscriptions({}, { take: null })).toHaveLength(0)
      })

      it("a new order is pushed only to users who may read orders, also to subscriptions made before the right was removed", async () => {
        const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
        const seed = (n: number, userId: string) =>
          service.createPushSubscriptions({ endpoint: sub(n).endpoint, p256dh: sub(n).keys.p256dh, auth: sub(n).keys.auth, user_id: userId })
        await seed(1, reader.userId)
        await seed(2, noOrders.userId) // subscribed earlier, the role was changed since
        await seed(3, noRole.userId)

        const region = await createRegion(getContainer(), "eur", "at")
        const order = await createDemoOrder(getContainer(), { regionId: region.id, paid: true })
        await orderPlacedPushHandler({ event: { data: { id: order.id }, name: "order.placed" }, container: getContainer(), pluginOptions: {} } as any)

        expect(sendNotification).toHaveBeenCalledTimes(1)
        expect(sendNotification.mock.calls[0][0].endpoint).toBe(sub(1).endpoint)
        // the ones left out keep their subscription (they may get the right back), they just get nothing
        expect(await service.listPushSubscriptions({}, { take: null })).toHaveLength(3)
      })

      it("a failing permission lookup sends nothing (fail closed) and does not throw", async () => {
        const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
        await service.createPushSubscriptions({ endpoint: sub(1).endpoint, p256dh: sub(1).keys.p256dh, auth: sub(1).keys.auth, user_id: reader.userId })
        const region = await createRegion(getContainer(), "eur", "at")
        const order = await createDemoOrder(getContainer(), { regionId: region.id, paid: true })
        jest.spyOn(rbac(), "retrieveActorAuthzContextConfig").mockRejectedValue(new Error("rbac down"))
        await orderPlacedPushHandler({ event: { data: { id: order.id }, name: "order.placed" }, container: getContainer(), pluginOptions: {} } as any)
        expect(sendNotification).not.toHaveBeenCalled()
        jest.restoreAllMocks()
      })
    })
  },
})
