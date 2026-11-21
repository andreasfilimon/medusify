import { MedusaModule } from "@medusajs/framework/modules-sdk"
import { Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import lowStockReservationPushHandler from "../../src/subscribers/low-stock-reservation-push"
import orderPlacedPushHandler from "../../src/subscribers/order-placed-push"
import { sendDailySummaries } from "../../src/lib/daily-summary"
import { createAdmin, sub } from "../helpers/admin"
import { createCatalogProduct, createLocation } from "../helpers/catalog"
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

      it("the reports need the right to read orders as well", async () => {
        const url = "/admin/medusify/reports?from=2026-03-01&to=2026-03-07"
        expect((await api.get(url, { headers: reader.headers })).status).toBe(200)
        for (const who of [noOrders, noRole]) {
          await expect(api.get(url, { headers: who.headers })).rejects.toMatchObject({ response: { status: 403 } })
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

      it("the daily summary goes only to users who may see the reports (read orders), the others keep their setting", async () => {
        const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
        const evening = new Date("2026-01-15T19:05:00Z") // 20:05 in Vienna
        const seed = (n: number, userId: string) =>
          service.createPushSubscriptions({ endpoint: sub(n).endpoint, p256dh: sub(n).keys.p256dh, auth: sub(n).keys.auth, user_id: userId, daily_summary_hour: 20, daily_summary_tz: "Europe/Vienna" })
        await seed(1, reader.userId)
        await seed(2, noOrders.userId)
        await seed(3, noRole.userId)
        expect(await sendDailySummaries(getContainer(), evening)).toEqual({ sent: 1, skipped: 2 })
        expect(sendNotification.mock.calls.map((c) => c[0].endpoint)).toEqual([sub(1).endpoint])
        const left = await service.listPushSubscriptions({ endpoint: [sub(2).endpoint, sub(3).endpoint] }, { take: null })
        expect(left.map((s: any) => [s.daily_summary_hour, s.daily_summary_sent_on])).toEqual([[20, null], [20, null]])
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
        const CATALOG_KEYS = ["catalog", "variant_edit", "product_status", "stock", "stock_new_level", "product_create", "upload", "stock_read", "customers", "discounts", "discount_create", "discount_edit", "manual_order", "order_edit", "exchange", "claim", "reports"]
        const ALL = { capture: true, mark_paid: true, cancel: true, cancel_refunding: true, deliver: true, refund: true, return: true, ship: true, ...Object.fromEntries(CATALOG_KEYS.map((k) => [k, true])) }
        const NONE = { capture: false, mark_paid: false, cancel: false, cancel_refunding: false, deliver: false, refund: false, return: false, ship: false, ...Object.fromEntries(CATALOG_KEYS.map((k) => [k, false])) }
        const actionsOf = async (who: { headers: Record<string, string> }) =>
          (await api.get("/admin/medusify/permissions", { headers: who.headers })).data.actions

        it("a reader of orders may only see the reports, a user without any role nothing", async () => {
          expect(await actionsOf(reader)).toEqual({ ...NONE, reports: true })
          expect(await actionsOf(noRole)).toEqual(NONE)
          expect((await api.get("/admin/medusify/permissions", { headers: reader.headers })).data.rbac).toBe(true)
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
            ["ship", ["fulfillment:create", "fulfillment:update", "order:update"], { ship: true, deliver: true, cancel: true }],
            ["half of ship (no fulfillment:create)", ["fulfillment:update", "order:update"], { deliver: true, cancel: true }],
            ["catalog", ["product:read", "product_variant:read"], { catalog: true }],
            ["half of catalog (no product_variant:read)", ["product:read"], {}],
            ["variant_edit", ["product_variant:update", "product:update"], { variant_edit: true, product_status: true }],
            ["product_status alone", ["product:update"], { product_status: true }],
            ["stock", ["inventory_item:read", "inventory_level:update"], { stock: true }],
            ["half of stock (no inventory_item:read)", ["inventory_level:update"], {}],
            ["stock_new_level", ["inventory_level:create"], { stock_new_level: true }],
            ["stock_read", ["product:read", "inventory_item:read"], { stock_read: true }],
            ["product_create", ["product:create", "product_variant:create", "inventory_item:create", "inventory_level:create", "sales_channel:update"], { product_create: true, stock_new_level: true }],
            ["half of product_create (no sales_channel:update)", ["product:create", "product_variant:create", "inventory_item:create", "inventory_level:create"], { stock_new_level: true }],
            ["upload", ["file:create"], { upload: true }],
            ["customers", ["customer:read", "order:read"], { customers: true, reports: true }],
            ["half of customers (no order:read)", ["customer:read"], {}],
            ["discounts", ["promotion:read"], { discounts: true }],
            ["discount_create", ["promotion:create"], { discount_create: true }],
            ["discount_edit", ["promotion:update"], { discount_edit: true }],
            ["manual_order", ["order:create", "order:update", "payment_collection:create"], { manual_order: true, cancel: true }],
            ["order_edit", ["order_change:create", "order_change:update", "order_change:delete", "order:update"], { order_edit: true, cancel: true }],
            ["exchange", ["order_exchange:create", "order_exchange:update", "order_exchange:delete", "order:update"], { exchange: true, cancel: true }],
            ["claim", ["order_claim:create", "order_claim:update", "order_claim:delete", "order:update"], { claim: true, cancel: true }],
            ["reports", ["order:read"], { reports: true }],
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
          expect(await actionsOf(upd)).toEqual({ ...NONE, mark_paid: true, cancel: true, deliver: true, variant_edit: true, product_status: true, discount_edit: true })
          // order:* covers only the order half of each action, so none of the two-part actions without the other half
          const ord = await createAdmin(getContainer(), "wild-ord@example.invalid")
          await giveRole(ord.userId, "all-order", ["order:*"])
          expect(await actionsOf(ord)).toEqual({ ...NONE, cancel: true, reports: true })
          await giveRole(ord.userId, "capture-too", ["capture:create"])
          expect(await actionsOf(ord)).toEqual({ ...NONE, cancel: true, capture: true, reports: true })
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
          // The ship route asks for the same rights: a reader and a user without a role are refused before anything is written.
          await expect(api.post(`/admin/medusify/orders/${orderId}/ship`, { notify: false }, { headers: reader.headers })).rejects.toMatchObject({ response: { status: 403 } })
          await expect(api.post(`/admin/medusify/orders/${orderId}/ship`, { notify: false }, { headers: withReturn.headers })).rejects.toMatchObject({ response: { status: 403 } })
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

      describe("catalog and stock routes", () => {
        let locA: string
        let locB: string
        let item: Awaited<ReturnType<typeof createCatalogProduct>>
        const as = async (name: string, keys: string[]) => {
          const who = await createAdmin(getContainer(), `${name}@example.invalid`)
          if (keys.length) await giveRole(who.userId, `role-${name}`, keys)
          return who
        }
        const stockOf = async (itemId: string, loc: string) => {
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const { data } = await query.graph({ entity: "inventory_level", fields: ["stocked_quantity"], filters: { inventory_item_id: itemId, location_id: loc } })
          return data[0] ? Number((data[0] as any).stocked_quantity) : undefined
        }

        beforeEach(async () => {
          locA = await createLocation(getContainer(), "Lager Wien")
          locB = await createLocation(getContainer(), "Lager Graz")
          item = await createCatalogProduct(getContainer(), { barcode: "4006381333931", levels: [{ location_id: locA, quantity: 10 }] })
        })

        it("list, detail and barcode lookup need the catalog rights, and nothing else opens them", async () => {
          const catalog = await as("catalog", ["product:read", "product_variant:read"])
          const half = await as("half", ["product:read"])
          const stockOnly = await as("stockonly", ["inventory_item:read", "inventory_level:update"])
          for (const url of ["/admin/medusify/products", `/admin/medusify/products/${item.productId}`, "/admin/medusify/variants/lookup?code=4006381333931"]) {
            expect((await api.get(url, { headers: catalog.headers })).status).toBe(200)
            for (const who of [half, stockOnly, noRole]) {
              await expect(api.get(url, { headers: who.headers })).rejects.toMatchObject({ response: { status: 403 } })
            }
          }
        })

        it("the stock is in the catalog answer only for a user who may read stock (inventory_item:read)", async () => {
          const catalog = await as("catalog-nostock", ["product:read", "product_variant:read"])
          const stocker = await as("catalog-stock", ["product:read", "product_variant:read", "inventory_item:read"])
          const variantsOf = async (url: string, who: { headers: Record<string, string> }) => {
            const data = (await api.get(url, { headers: who.headers })).data
            if (data.product) return data.product.variants
            if (data.matches) return data.matches.map((m: any) => m.variant)
            return data.products.find((p: any) => p.id === item.productId).variants
          }
          for (const url of ["/admin/medusify/products", `/admin/medusify/products/${item.productId}`, "/admin/medusify/variants/lookup?code=4006381333931"]) {
            const [hidden] = await variantsOf(url, catalog)
            expect({ url, inventory: hidden.inventory, stock_total: hidden.stock_total, stock_hidden: hidden.stock_hidden, stock_editable: hidden.stock_editable }).toEqual({
              url,
              inventory: [],
              stock_total: null,
              stock_hidden: true,
              stock_editable: false,
            })
            const [shown] = await variantsOf(url, stocker)
            expect({ url, stock_total: shown.stock_total, stock_hidden: shown.stock_hidden, stocked: shown.inventory[0].levels[0].stocked }).toEqual({ url, stock_total: 10, stock_hidden: false, stocked: 10 })
          }
        })

        it("a price needs the variant update rights, and nothing is written without them", async () => {
          const editor = await as("editor", ["product_variant:update", "product:update"])
          const half = await as("halfeditor", ["product_variant:update"])
          const url = `/admin/medusify/variants/${item.variantId}/price`
          await expect(api.post(url, { currency_code: "eur", amount: 99 }, { headers: half.headers })).rejects.toMatchObject({ response: { status: 403 } })
          await expect(api.post(url, { currency_code: "eur", amount: 99 }, { headers: reader.headers })).rejects.toMatchObject({ response: { status: 403 } })
          expect((await api.post(url, { currency_code: "eur", amount: 99 }, { headers: editor.headers })).data.prices[0].amount).toBe(99)
        })

        it("a count needs the stock rights; a new level at a location needs the right to create levels on top, and is refused whole", async () => {
          const counter = await as("counter", ["inventory_item:read", "inventory_level:update"])
          const creator = await as("creator", ["inventory_item:read", "inventory_level:update", "inventory_level:create"])
          const half = await as("halfcounter", ["inventory_level:update"])
          const body = (loc: string, key: string) => ({ mode: "set", inventory_item_id: item.inventoryItemId, location_id: loc, quantity: 4, idempotency_key: key })
          await expect(api.post("/admin/medusify/inventory", body(locA, "rbac-key-0001"), { headers: half.headers })).rejects.toMatchObject({ response: { status: 403 } })
          expect((await api.post("/admin/medusify/inventory", body(locA, "rbac-key-0002"), { headers: counter.headers })).data.stocked).toBe(4)
          // no level at Graz yet: the counter may not create one, nothing is created and the key is not used up
          const refused = await api.post("/admin/medusify/inventory", body(locB, "rbac-key-0003"), { headers: counter.headers }).catch((e) => e.response)
          expect(refused.status).toBe(403)
          expect(await stockOf(item.inventoryItemId!, locB)).toBeUndefined()
          const ok = await api.post("/admin/medusify/inventory", body(locB, "rbac-key-0003"), { headers: creator.headers })
          expect(ok.data).toMatchObject({ stocked: 4, replayed: false })
          expect(await stockOf(item.inventoryItemId!, locB)).toBe(4)
        })

        it("quick create needs all rights Medusa asks for when it makes a product, variant, item, level and sales-channel link", async () => {
          const all = ["product:create", "product_variant:create", "inventory_item:create", "inventory_level:create", "sales_channel:update"]
          const full = await as("creator-all", all)
          const missing = await as("creator-missing", all.slice(0, 4))
          const b = (key: string) => ({ title: "Neue Kerze", status: "draft", price: { currency_code: "eur", amount: 5 }, stock: { location_id: locA, quantity: 1 }, idempotency_key: key })
          await expect(api.post("/admin/medusify/products", b("rbac-new-0001"), { headers: missing.headers })).rejects.toMatchObject({ response: { status: 403 } })
          expect((await api.post("/admin/medusify/products", b("rbac-new-0001"), { headers: full.headers })).status).toBe(201)
        })

        it("the low-stock push goes only to users who may read products and their stock", async () => {
          const may = await as("may-read-stock", ["product:read", "inventory_item:read"])
          const mayNot = await as("may-not", ["product:read"])
          const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
          const seed = (n: number, userId: string) => service.createPushSubscriptions({ endpoint: sub(n).endpoint, p256dh: sub(n).keys.p256dh, auth: sub(n).keys.auth, user_id: userId })
          await seed(1, may.userId)
          await seed(2, mayNot.userId)
          await seed(3, noRole.userId)
          const r = await getContainer().resolve(Modules.INVENTORY).createReservationItems({ inventory_item_id: item.inventoryItemId, location_id: locA, quantity: 8 })
          await lowStockReservationPushHandler({ event: { name: "reservation-item.created", data: { id: (r as any).id } }, container: getContainer(), pluginOptions: {} } as any)
          expect(sendNotification).toHaveBeenCalledTimes(1)
          expect(sendNotification.mock.calls[0][0].endpoint).toBe(sub(1).endpoint)
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
