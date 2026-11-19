import { MedusaModule } from "@medusajs/framework/modules-sdk"
import { Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import orderPlacedPushHandler from "../../src/subscribers/order-placed-push"
import { createAdmin, sub } from "../helpers/admin"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createDemoOrder, createRegion, fulfillDemoItems, refundDemoOrder } from "../helpers/orders"
import { rbacRunner } from "../helpers/rbac-license"

// Sets the throw-away license before the runner loads medusa-config.ts (it adds the licensed RBAC module only then).
const runner = rbacRunner()

jest.setTimeout(120 * 1000)

const sendNotification = jest.fn()
jest.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: jest.fn(),
}))

runner({
  testSuite: ({ api, getContainer }) => {
    describe("medusify with Medusa RBAC switched on", () => {
      const rbac = () => getContainer().resolve(Modules.RBAC) as any

      /** A role that carries exactly the given policies (resource:operation), assigned to the user. */
      async function giveRole(userId: string, name: string, keys: string[]) {
        const role = await rbac().createRbacRoles({ name })
        for (const key of keys) {
          const [resource, operation] = key.split(":")
          let [policy] = await rbac().listRbacPolicies({ resource, operation })
          // Medusa seeds `*:*`; the other wildcards (`order:*`, `*:update`) are stored by the merchant, so the test stores them
          if (!policy && (resource === "*" || operation === "*")) {
            policy = await rbac().createRbacPolicies({ key, resource, operation, name: key })
          }
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

      describe("the app's actions (permissions and the return route)", () => {
        const RETURN_RIGHTS = ["return:create", "return:update", "order:update"]
        const ALL = { capture: true, mark_paid: true, cancel: true, cancel_refunding: true, deliver: true, refund: true, return: true }
        const NONE = { capture: false, mark_paid: false, cancel: false, cancel_refunding: false, deliver: false, refund: false, return: false }
        const actionsOf = async (who: { headers: Record<string, string> }) =>
          (await api.get("/admin/medusify/permissions", { headers: who.headers })).data.actions

        it("a reader of orders may do none of the actions, a user without any role neither", async () => {
          expect(await actionsOf(reader)).toEqual(NONE)
          expect(await actionsOf(noRole)).toEqual(NONE)
        })

        it("each action turns on with exactly the rights Medusa asks for on its own route", async () => {
          const cases: [string, string[], Record<string, boolean>][] = [
            ["cancel", ["order:update"], { cancel: true }],
            ["capture", ["capture:create", "order:update"], { capture: true, cancel: true }],
            ["mark_paid", ["payment_collection:update", "order:update"], { mark_paid: true, cancel: true }],
            ["deliver", ["fulfillment:update", "order:update"], { deliver: true, cancel: true }],
            ["refund", ["refund:create", "order:update"], { refund: true, cancel: true, cancel_refunding: true }],
            ["return", RETURN_RIGHTS, { return: true, cancel: true }],
            ["half of capture (no order:update)", ["capture:create"], {}],
            ["half of return (no return:create)", ["return:update", "order:update"], { cancel: true }],
          ]
          for (const [n, [name, keys, on]] of cases.entries()) {
            const who = await createAdmin(getContainer(), `case${n}@example.invalid`)
            await giveRole(who.userId, `role-${n}-${name}`, keys)
            expect({ case: name, ...(await actionsOf(who)) }).toEqual({ case: name, ...NONE, ...on })
          }
        })

        it("wildcards count: a role with *:*, *:update or order:* gets what they cover", async () => {
          const any = await createAdmin(getContainer(), "wild-any@example.invalid")
          await giveRole(any.userId, "everything", ["*:*"])
          expect(await actionsOf(any)).toEqual(ALL)
          const upd = await createAdmin(getContainer(), "wild-upd@example.invalid")
          await giveRole(upd.userId, "every-update", ["*:update"])
          // updates only: needs create for capture, refund and return
          expect(await actionsOf(upd)).toEqual({ ...NONE, mark_paid: true, cancel: true, deliver: true })
          // order:* covers only the order half of each action, so none of the two-part actions without the other half
          const ord = await createAdmin(getContainer(), "wild-ord@example.invalid")
          await giveRole(ord.userId, "all-order", ["order:*"])
          expect(await actionsOf(ord)).toEqual({ ...NONE, cancel: true })
          await giveRole(ord.userId, "capture-too", ["capture:create"])
          expect(await actionsOf(ord)).toEqual({ ...NONE, cancel: true, capture: true })
        })

        async function fulfilledOrder() {
          const region = await createRegion(getContainer(), "eur", "at")
          const order = await createDemoOrder(getContainer(), { regionId: region.id, paid: true, items: [{ title: "Widget", quantity: 2, unit_price: 19.99 }] })
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const {
            data: [full],
          } = await query.graph({ entity: "order", fields: ["id", "items.id"], filters: { id: order.id } })
          await fulfillDemoItems(getContainer(), order.id, [{ id: full.items[0].id, quantity: 2 }])
          return { orderId: order.id, itemId: full.items[0].id as string }
        }

        it("canceling an order that holds captured money needs the refund right as well, because Medusa refunds it", async () => {
          const canceler = await createAdmin(getContainer(), "canceler@example.invalid")
          await giveRole(canceler.userId, "cancel-only", ["order:update"])
          const refunder = await createAdmin(getContainer(), "refunder@example.invalid")
          await giveRole(refunder.userId, "cancel-and-refund", ["order:update", "refund:create"])
          const region = await createRegion(getContainer(), "eur", "at")
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const statusOf = async (id: string) =>
            (await query.graph({ entity: "order", fields: ["id", "status"], filters: { id } })).data[0].status as string
          const cancel = (id: string, who: { headers: Record<string, string> }) =>
            api.post(`/admin/medusify/orders/${id}/cancel`, {}, { headers: who.headers })

          const paid = await createDemoOrder(getContainer(), { regionId: region.id, paid: true })
          await expect(cancel(paid.id, canceler)).rejects.toMatchObject({ response: { status: 403 } })
          await expect(cancel(paid.id, noRole)).rejects.toMatchObject({ response: { status: 403 } })
          expect(await statusOf(paid.id)).toBe("pending") // nothing was canceled, no money went back
          expect((await cancel(paid.id, refunder)).status).toBe(200)
          expect(await statusOf(paid.id)).toBe("canceled")

          // nothing captured, so nothing to refund: the order right is enough
          const unpaid = await createDemoOrder(getContainer(), { regionId: region.id })
          expect((await cancel(unpaid.id, canceler)).status).toBe(200)
          expect(await statusOf(unpaid.id)).toBe("canceled")

          // a refunded order has nothing left to give back either
          const refundedFully = await createDemoOrder(getContainer(), { regionId: region.id, paid: true })
          await refundDemoOrder(getContainer(), refundedFully.id, 44.98) // 2 x 19.99 + 5
          expect((await cancel(refundedFully.id, canceler)).status).toBe(200)

          await expect(cancel("order_does_not_exist", refunder)).rejects.toMatchObject({ response: { status: 404 } })
        })

        it("the return route needs the return and order rights, and the refund right for a refund", async () => {
          const withReturn = await createAdmin(getContainer(), "withreturn@example.invalid")
          await giveRole(withReturn.userId, "returns", RETURN_RIGHTS)
          const withRefund = await createAdmin(getContainer(), "withrefund@example.invalid")
          await giveRole(withRefund.userId, "returns-and-refunds", [...RETURN_RIGHTS, "refund:create"])
          const { orderId, itemId } = await fulfilledOrder()
          const body = (extra: Record<string, unknown> = {}) => ({ order_id: orderId, items: [{ id: itemId, quantity: 1 }], ...extra })

          await expect(api.post("/admin/medusify/returns", body(), { headers: reader.headers })).rejects.toMatchObject({ response: { status: 403 } })
          await expect(api.post("/admin/medusify/returns", body(), { headers: noRole.headers })).rejects.toMatchObject({ response: { status: 403 } })
          // return rights without the refund right: the return is refused as a whole, nothing is written
          await expect(api.post("/admin/medusify/returns", body({ refund_amount: 5 }), { headers: withReturn.headers })).rejects.toMatchObject({
            response: { status: 403 },
          })
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          expect((await query.graph({ entity: "return", fields: ["id"], filters: { order_id: orderId } })).data).toHaveLength(0)

          const ok = await api.post("/admin/medusify/returns", body(), { headers: withReturn.headers })
          expect(ok.status).toBe(201)
          const refunded = await api.post("/admin/medusify/returns", body({ refund_amount: 5 }), { headers: withRefund.headers })
          expect(refunded.status).toBe(201)
          expect(refunded.data.refunded).toBe(5)
        })
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
