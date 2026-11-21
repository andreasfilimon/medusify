import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  beginReturnOrderWorkflow,
  cancelOrderWorkflow,
  confirmReturnRequestWorkflow,
  requestItemReturnWorkflow,
} from "@medusajs/medusa/core-flows"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import { countToShip } from "../../src/lib/dashboard"
import orderCanceledPushHandler from "../../src/subscribers/order-canceled-push"
import orderPlacedPushHandler from "../../src/subscribers/order-placed-push"
import returnRequestedPushHandler from "../../src/subscribers/return-requested-push"
import { createAdmin, sub } from "../helpers/admin"
import { createDemoOrder, createRegion, fulfillDemoItems, refundDemoOrder } from "../helpers/orders"

jest.setTimeout(120 * 1000)

const sendNotification = jest.fn()
jest.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: jest.fn(),
}))

// Wraps countToShip so one test can make it fail; everywhere else it is the real function.
const countToShipFails = jest.fn()
jest.mock("../../src/lib/dashboard", () => {
  const actual = jest.requireActual("../../src/lib/dashboard")
  return {
    ...actual,
    countToShip: (...args: unknown[]) => {
      const failure = countToShipFails()
      return failure ? Promise.reject(failure) : actual.countToShip(...args)
    },
  }
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const handlerArgs = (container: unknown, name: string, data: unknown) =>
  ({ event: { data, name }, container, pluginOptions: {} }) as any

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("orders in the app: returns, badge number, push kinds", () => {
      const service = () => getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
      const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
      let admin: Awaited<ReturnType<typeof createAdmin>>
      let regionId: string

      const seed = (n: number, userId: string, extra: Record<string, unknown> = {}) =>
        service().createPushSubscriptions({
          endpoint: sub(n).endpoint,
          p256dh: sub(n).keys.p256dh,
          auth: sub(n).keys.auth,
          user_id: userId,
          ...extra,
        })
      const sentBodies = () => sendNotification.mock.calls.map((c) => JSON.parse(c[1]))

      beforeEach(async () => {
        jest.restoreAllMocks()
        sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
        admin = await createAdmin(getContainer())
        regionId = (await createRegion(getContainer(), "eur", "at")).id
      })

      /** `fulfilled`: the goods are out, which is what Medusa needs before a return. */
      async function orderWithItems(opts: { fulfilled?: boolean } = {}) {
        // 2 x 19.99 + 3 x 10 + 5 shipping = 74.98
        const order = await createDemoOrder(getContainer(), {
          regionId,
          paid: true,
          items: [
            { title: "Widget", quantity: 2, unit_price: 19.99 },
            { title: "Gadget", quantity: 3, unit_price: 10 },
          ],
        })
        const {
          data: [full],
        } = await query().graph({
          entity: "order",
          fields: ["id", "items.id", "items.title", "items.quantity"],
          filters: { id: order.id },
        })
        const byTitle = (t: string) => full.items.find((i: any) => i.title === t).id as string
        const ids = { orderId: order.id, widget: byTitle("Widget"), gadget: byTitle("Gadget") }
        if (opts.fulfilled) {
          await fulfillDemoItems(getContainer(), order.id, [
            { id: ids.widget, quantity: 2 },
            { id: ids.gadget, quantity: 3 },
          ])
        }
        return ids
      }

      async function orderState(orderId: string) {
        const {
          data: [o],
        } = await query().graph({
          entity: "order",
          fields: [
            "id",
            "summary.current_order_total",
            "summary.refunded_total",
            "items.id",
            "items.detail.return_received_quantity",
            "items.detail.return_requested_quantity",
          ],
          filters: { id: orderId },
        })
        return o as any
      }
      const returnsOf = async (orderId: string) =>
        (await query().graph({ entity: "return", fields: ["id", "status", "metadata", "received_at"], filters: { order_id: orderId } }))
          .data as any[]

      describe("POST /admin/medusify/returns", () => {
        it("takes a return in: items and quantities, receipt confirmed, no refund", async () => {
          const { orderId, widget, gadget } = await orderWithItems({ fulfilled: true })
          const res = await api.post(
            "/admin/medusify/returns",
            { order_id: orderId, items: [{ id: widget, quantity: 1 }, { id: gadget, quantity: 2 }] },
            { headers: admin.headers }
          )
          expect(res.status).toBe(201)
          expect(res.data).toMatchObject({ order_id: orderId, refunded: 0 })
          const [ret] = await returnsOf(orderId)
          expect(ret.id).toBe(res.data.return_id)
          expect(ret.status).toBe("received")
          expect(ret.metadata).toMatchObject({ medusify_source: "app" })
          const o = await orderState(orderId)
          const received = Object.fromEntries(o.items.map((i: any) => [i.id, Number(i.detail.return_received_quantity)]))
          expect(received).toEqual({ [widget]: 1, [gadget]: 2 })
          expect(Number(o.summary.refunded_total)).toBe(0)
        })

        it("refunds right away when asked, up to what is still refundable", async () => {
          const { orderId, widget } = await orderWithItems({ fulfilled: true })
          const res = await api.post(
            "/admin/medusify/returns",
            { order_id: orderId, items: [{ id: widget, quantity: 1 }], refund_amount: 19.99, note: "Demo return" },
            { headers: admin.headers }
          )
          expect(res.status).toBe(201)
          expect(res.data.refunded).toBe(19.99)
          expect(Number((await orderState(orderId)).summary.refunded_total)).toBeCloseTo(19.99, 2)
        })

        it("rejects a refund above the refundable amount before anything is written", async () => {
          const { orderId, widget } = await orderWithItems({ fulfilled: true })
          await refundDemoOrder(getContainer(), orderId, 70) // 4.98 of 74.98 left
          await expect(
            api.post(
              "/admin/medusify/returns",
              { order_id: orderId, items: [{ id: widget, quantity: 1 }], refund_amount: 19.99 },
              { headers: admin.headers }
            )
          ).rejects.toMatchObject({ response: { status: 400 } })
          expect(await returnsOf(orderId)).toHaveLength(0)
          expect(Number((await orderState(orderId)).summary.refunded_total)).toBe(70)
        })

        it("rejects an item of another order, an empty list, a canceled order and bad input", async () => {
          const a = await orderWithItems({ fulfilled: true })
          const b = await orderWithItems({ fulfilled: true })
          const post = (body: unknown) => api.post("/admin/medusify/returns", body, { headers: admin.headers })
          await expect(post({ order_id: a.orderId, items: [{ id: b.widget, quantity: 1 }] })).rejects.toMatchObject({ response: { status: 400 } })
          await expect(post({ order_id: a.orderId, items: [] })).rejects.toMatchObject({ response: { status: 400 } })
          await expect(post({ order_id: a.orderId, items: [{ id: a.widget, quantity: 0 }] })).rejects.toMatchObject({ response: { status: 400 } })
          await expect(post({ order_id: a.orderId, items: [{ id: a.widget, quantity: 1 }], refund_amount: -5 })).rejects.toMatchObject({ response: { status: 400 } })
          await cancelOrderWorkflow(getContainer()).run({ input: { order_id: a.orderId } })
          await expect(post({ order_id: a.orderId, items: [{ id: a.widget, quantity: 1 }] })).rejects.toMatchObject({ response: { status: 400 } })
          expect(await returnsOf(a.orderId)).toHaveLength(0)
        })

        it("needs a login", async () => {
          const { orderId, widget } = await orderWithItems()
          await expect(api.post("/admin/medusify/returns", { order_id: orderId, items: [{ id: widget, quantity: 1 }] })).rejects.toMatchObject({
            response: { status: 401 },
          })
        })

        describe("idempotency key", () => {
          const live = async (orderId: string) => (await returnsOf(orderId)).filter((r) => r.status !== "canceled")

          it("a repeat with the same key is answered with the same return: no second return, no second refund", async () => {
            const { orderId, widget } = await orderWithItems({ fulfilled: true })
            const body = { order_id: orderId, items: [{ id: widget, quantity: 1 }], refund_amount: 19.99, idempotency_key: "app-key-0001" }
            const first = await api.post("/admin/medusify/returns", body, { headers: admin.headers })
            const second = await api.post("/admin/medusify/returns", body, { headers: admin.headers })
            expect(first.status).toBe(201)
            expect(second.status).toBe(200)
            expect(second.data).toMatchObject({ return_id: first.data.return_id, refunded: 19.99, replayed: true })
            expect(await live(orderId)).toHaveLength(1)
            const o = await orderState(orderId)
            expect(Number(o.summary.refunded_total)).toBeCloseTo(19.99, 2)
            expect(Number(o.items.find((i: any) => i.id === widget).detail.return_received_quantity)).toBe(1)
          })

          it("two requests at the same moment with one key make one return", async () => {
            const { orderId, widget } = await orderWithItems({ fulfilled: true })
            const body = { order_id: orderId, items: [{ id: widget, quantity: 1 }], refund_amount: 19.99, idempotency_key: "app-key-0002" }
            const post = () => api.post("/admin/medusify/returns", body, { headers: admin.headers })
            const [a, b] = await Promise.all([post(), post()])
            expect([a.status, b.status].sort()).toEqual([200, 201])
            expect(a.data.return_id).toBe(b.data.return_id)
            expect(await live(orderId)).toHaveLength(1)
            expect(Number((await orderState(orderId)).summary.refunded_total)).toBeCloseTo(19.99, 2)
          })

          it("the same key with other content is refused and writes nothing", async () => {
            const { orderId, widget, gadget } = await orderWithItems({ fulfilled: true })
            const key = "app-key-0003"
            await api.post("/admin/medusify/returns", { order_id: orderId, items: [{ id: widget, quantity: 1 }], idempotency_key: key }, { headers: admin.headers })
            await expect(
              api.post("/admin/medusify/returns", { order_id: orderId, items: [{ id: gadget, quantity: 1 }], idempotency_key: key }, { headers: admin.headers })
            ).rejects.toMatchObject({ response: { status: 409 } })
            expect(await live(orderId)).toHaveLength(1)
          })

          it("a failed first try leaves the key free, and the same key on another order is a new request", async () => {
            const a = await orderWithItems({ fulfilled: true })
            const b = await orderWithItems({ fulfilled: true })
            const key = "app-key-0004"
            await expect(
              api.post("/admin/medusify/returns", { order_id: a.orderId, items: [{ id: a.widget, quantity: 1 }], refund_amount: 9999, idempotency_key: key }, { headers: admin.headers })
            ).rejects.toMatchObject({ response: { status: 400 } })
            expect(await live(a.orderId)).toHaveLength(0)
            const ok = await api.post("/admin/medusify/returns", { order_id: a.orderId, items: [{ id: a.widget, quantity: 1 }], idempotency_key: key }, { headers: admin.headers })
            expect(ok.status).toBe(201)
            const other = await api.post("/admin/medusify/returns", { order_id: b.orderId, items: [{ id: b.widget, quantity: 1 }], idempotency_key: key }, { headers: admin.headers })
            expect(other.status).toBe(201)
            expect(other.data.return_id).not.toBe(ok.data.return_id)
          })

          it("rejects a key that is empty, too short or too long", async () => {
            const { orderId, widget } = await orderWithItems({ fulfilled: true })
            for (const idempotency_key of ["", "abc", "x".repeat(129)]) {
              await expect(
                api.post("/admin/medusify/returns", { order_id: orderId, items: [{ id: widget, quantity: 1 }], idempotency_key }, { headers: admin.headers })
              ).rejects.toMatchObject({ response: { status: 400 } })
            }
            expect(await live(orderId)).toHaveLength(0)
          })
        })

        it("takes back only what was shipped: unshipped goods and more than was shipped are refused, nothing stays open", async () => {
          const unshipped = await orderWithItems()
          const shipped = await orderWithItems({ fulfilled: true })
          const post = (body: unknown) => api.post("/admin/medusify/returns", body, { headers: admin.headers })
          await expect(post({ order_id: unshipped.orderId, items: [{ id: unshipped.widget, quantity: 1 }] })).rejects.toMatchObject({ response: { status: 400 } })
          // 3 gadgets went out, 4 do not pass our check but fail inside Medusa's request step
          await expect(post({ order_id: shipped.orderId, items: [{ id: shipped.gadget, quantity: 4 }] })).rejects.toMatchObject({ response: { status: 400 } })
          for (const { orderId } of [unshipped, shipped]) {
            expect((await returnsOf(orderId)).filter((r) => r.status !== "canceled")).toHaveLength(0)
          }
        })
      })

      describe("POST /admin/payments/:id/refund with the app's key", () => {
        it("a repeat with the same key refunds once, a new key refunds again", async () => {
          const { orderId } = await orderWithItems({ fulfilled: true })
          const {
            data: [o],
          } = await query().graph({ entity: "order", fields: ["id", "payment_collections.payments.id"], filters: { id: orderId } })
          const paymentId = o.payment_collections[0].payments[0].id as string
          const refund = (idempotency_key: string) =>
            api.post(`/admin/payments/${paymentId}/refund`, { amount: 10, idempotency_key }, { headers: admin.headers })
          await refund("sheet-key-0001")
          await refund("sheet-key-0001")
          expect(Number((await orderState(orderId)).summary.refunded_total)).toBe(10)
          await refund("sheet-key-0002")
          expect(Number((await orderState(orderId)).summary.refunded_total)).toBe(20)
        })
      })

      describe("badge number in the push", () => {
        it("counts the orders to ship: paid and not shipped, not canceled", async () => {
          expect(await countToShip(getContainer())).toBe(0)
          const a = await orderWithItems()
          await orderWithItems()
          await createDemoOrder(getContainer(), { regionId }) // not paid ⇒ not to ship
          expect(await countToShip(getContainer())).toBe(2)
          await cancelOrderWorkflow(getContainer()).run({ input: { order_id: a.orderId } })
          expect(await countToShip(getContainer())).toBe(1)
        })

        it("is in the new-order push: kind, shop and badge", async () => {
          await seed(1, admin.userId)
          await orderWithItems()
          const second = await orderWithItems()
          await sleep(1500) // the order.placed events of the demo orders are handled first
          sendNotification.mockClear()
          await orderPlacedPushHandler(handlerArgs(getContainer(), "order.placed", { id: second.orderId }))
          expect(sentBodies()[0].data).toEqual({
            url: `/medusify/orders/${second.orderId}`,
            kind: "order_placed",
            shop: "Testshop",
            badge: 2,
          })
        })

        it("a failed count sends the push without a number instead of no push", async () => {
          await seed(1, admin.userId)
          const { orderId } = await orderWithItems()
          await sleep(1500) // the order.placed event of the demo order is handled first
          sendNotification.mockClear()
          countToShipFails.mockReturnValueOnce(new Error("db down"))
          await orderPlacedPushHandler(handlerArgs(getContainer(), "order.placed", { id: orderId }))
          expect(sendNotification).toHaveBeenCalledTimes(1)
          expect(sentBodies()[0].data.badge).toBeUndefined()
        })
      })

      describe("push preferences", () => {
        it("GET shows every optional kind as on, POST switches one kind for this device only", async () => {
          await seed(1, admin.userId)
          await seed(2, admin.userId)
          const q = encodeURIComponent(sub(1).endpoint)
          expect((await api.get(`/admin/medusify/push-preferences?endpoint=${q}`, { headers: admin.headers })).data).toEqual({
            kinds: { canceled: true, return_requested: true, low_stock: true },
            low_stock_threshold: 5,
            daily_summary: null,
          })
          const off = await api.post(
            "/admin/medusify/push-preferences",
            { endpoint: sub(1).endpoint, kind: "canceled", enabled: false },
            { headers: admin.headers }
          )
          expect(off.data).toEqual({ kinds: { canceled: false, return_requested: true, low_stock: true }, low_stock_threshold: 5, daily_summary: null })
          const other = await api.get(`/admin/medusify/push-preferences?endpoint=${encodeURIComponent(sub(2).endpoint)}`, { headers: admin.headers })
          expect(other.data.kinds).toEqual({ canceled: true, return_requested: true, low_stock: true })
          const on = await api.post(
            "/admin/medusify/push-preferences",
            { endpoint: sub(1).endpoint, kind: "canceled", enabled: true },
            { headers: admin.headers }
          )
          expect(on.data.kinds).toEqual({ canceled: true, return_requested: true, low_stock: true })
        })

        it("two switches at the same moment both stay (no lost update)", async () => {
          await seed(1, admin.userId)
          // Widens the gap between reading the stored list and writing the new one, so an unprotected read-modify-write loses one switch.
          const original = service().listPushSubscriptions.bind(service())
          jest.spyOn(service(), "listPushSubscriptions").mockImplementation(async (...args: unknown[]) => {
            const rows = await original(...args)
            await sleep(150)
            return rows
          })
          const post = (kind: string) =>
            api.post("/admin/medusify/push-preferences", { endpoint: sub(1).endpoint, kind, enabled: false }, { headers: admin.headers })
          await Promise.all([post("canceled"), post("return_requested")])
          jest.restoreAllMocks()
          const [row] = await service().listPushSubscriptions({ endpoint: sub(1).endpoint })
          expect([...row.disabled_kinds].sort()).toEqual(["canceled", "return_requested"])
        })

        it("refuses unknown kinds, the always-on kind, and a device that belongs to someone else", async () => {
          const other = await createAdmin(getContainer(), "other@example.invalid")
          await seed(1, other.userId)
          await seed(2, admin.userId)
          const post = (body: unknown) => api.post("/admin/medusify/push-preferences", body, { headers: admin.headers })
          await expect(post({ endpoint: sub(2).endpoint, kind: "nonsense", enabled: false })).rejects.toMatchObject({ response: { status: 400 } })
          await expect(post({ endpoint: sub(2).endpoint, kind: "order_placed", enabled: false })).rejects.toMatchObject({ response: { status: 400 } })
          await expect(post({ endpoint: sub(1).endpoint, kind: "canceled", enabled: false })).rejects.toMatchObject({ response: { status: 404 } })
          await expect(
            api.get(`/admin/medusify/push-preferences?endpoint=${encodeURIComponent(sub(1).endpoint)}`, { headers: admin.headers })
          ).rejects.toMatchObject({ response: { status: 404 } })
          expect((await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0].disabled_kinds).toEqual([])
        })

        it("the low-stock kind switches like the others, and its threshold is kept per device", async () => {
          await seed(1, admin.userId)
          await seed(2, admin.userId)
          const post = (endpoint: string, body: Record<string, unknown>) => api.post("/admin/medusify/push-preferences", { endpoint, ...body }, { headers: admin.headers })
          const off = await post(sub(1).endpoint, { kind: "low_stock", enabled: false })
          expect(off.data).toEqual({ kinds: { canceled: true, return_requested: true, low_stock: false }, low_stock_threshold: 5, daily_summary: null })
          const set = await post(sub(1).endpoint, { low_stock_threshold: 12, daily_summary: null })
          // the threshold does not touch the switches, and the switch does not touch the threshold
          expect(set.data).toEqual({ kinds: { canceled: true, return_requested: true, low_stock: false }, low_stock_threshold: 12, daily_summary: null })
          const other = await api.get(`/admin/medusify/push-preferences?endpoint=${encodeURIComponent(sub(2).endpoint)}`, { headers: admin.headers })
          expect(other.data.low_stock_threshold).toBe(5)
          expect((await post(sub(1).endpoint, { low_stock_threshold: 0 })).data.low_stock_threshold).toBe(0)
          for (const bad of [-1, 10000, 2.5, "7"]) {
            await expect(post(sub(1).endpoint, { low_stock_threshold: bad })).rejects.toMatchObject({ response: { status: 400 } })
          }
          expect((await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0].low_stock_threshold).toBe(0)
          await expect(post(sub(9).endpoint, { low_stock_threshold: 3 })).rejects.toMatchObject({ response: { status: 404 } })
        })

        it("the daily summary is off by default, gets an hour and a time zone per device, and switches off again", async () => {
          await seed(1, admin.userId)
          await seed(2, admin.userId)
          const post = (endpoint: string, body: Record<string, unknown>) => api.post("/admin/medusify/push-preferences", { endpoint, ...body }, { headers: admin.headers })
          const on = await post(sub(1).endpoint, { daily_summary: { hour: 20, tz: "Europe/Vienna" } })
          expect(on.data).toEqual({ kinds: { canceled: true, return_requested: true, low_stock: true }, low_stock_threshold: 5, daily_summary: { hour: 20, tz: "Europe/Vienna" } })
          const row = (await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0]
          expect([row.daily_summary_hour, row.daily_summary_tz]).toEqual([20, "Europe/Vienna"])
          // the other device of the same user keeps its own setting
          expect((await api.get(`/admin/medusify/push-preferences?endpoint=${encodeURIComponent(sub(2).endpoint)}`, { headers: admin.headers })).data.daily_summary).toBeNull()
          for (const bad of [{ hour: 24, tz: "Europe/Vienna" }, { hour: -1, tz: "UTC" }, { hour: 7.5, tz: "UTC" }, { hour: 7, tz: "Mars/Base" }, { hour: 7 }]) {
            await expect(post(sub(1).endpoint, { daily_summary: bad })).rejects.toMatchObject({ response: { status: 400 } })
          }
          expect((await post(sub(1).endpoint, { daily_summary: null })).data.daily_summary).toBeNull()
          expect((await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0].daily_summary_hour).toBeNull()
        })

        it("a device that is not subscribed gets 404, not a made-up answer", async () => {
          await expect(
            api.get(`/admin/medusify/push-preferences?endpoint=${encodeURIComponent(sub(9).endpoint)}`, { headers: admin.headers })
          ).rejects.toMatchObject({ response: { status: 404 } })
        })
      })

      describe("push for cancel and return request", () => {
        it("order.canceled goes to devices that did not switch it off, with kind and badge", async () => {
          await seed(1, admin.userId)
          await seed(2, admin.userId, { disabled_kinds: ["canceled"] })
          const { orderId } = await orderWithItems()
          await cancelOrderWorkflow(getContainer()).run({ input: { order_id: orderId } })
          await sleep(1500) // the real subscriber answers the event first
          sendNotification.mockClear()
          await orderCanceledPushHandler(handlerArgs(getContainer(), "order.canceled", { id: orderId }))
          expect(sendNotification).toHaveBeenCalledTimes(1)
          expect(sendNotification.mock.calls[0][0].endpoint).toBe(sub(1).endpoint)
          expect(sentBodies()[0]).toEqual({
            title: "Testshop: Bestellung storniert #1",
            body: "74,98\u00a0€",
            data: { url: `/medusify/orders/${orderId}`, kind: "canceled", shop: "Testshop", badge: 0 },
            tag: `order-${orderId}-canceled`,
          })
        })

        it("is wired up: an order.canceled event on the bus reaches the sender", async () => {
          await seed(1, admin.userId)
          const { orderId } = await orderWithItems()
          await cancelOrderWorkflow(getContainer()).run({ input: { order_id: orderId } })
          sendNotification.mockClear()
          await getContainer().resolve(Modules.EVENT_BUS).emit({ name: "order.canceled", data: { id: orderId } })
          const end = Date.now() + 15000
          while (!sendNotification.mock.calls.length && Date.now() < end) await new Promise((r) => setTimeout(r, 100))
          expect(sendNotification).toHaveBeenCalled()
        })

        async function requestedReturn(orderId: string, itemId: string, metadata?: Record<string, unknown>) {
          const { result } = await beginReturnOrderWorkflow(getContainer()).run({
            input: { order_id: orderId, metadata: metadata ?? null } as any,
          })
          const returnId = (result as any).return_id as string
          await requestItemReturnWorkflow(getContainer()).run({ input: { return_id: returnId, items: [{ id: itemId, quantity: 2 }] } as any })
          await confirmReturnRequestWorkflow(getContainer()).run({ input: { return_id: returnId } })
          return returnId
        }

        it("order.return_requested goes out for a return the customer asked for", async () => {
          await seed(1, admin.userId)
          await seed(2, admin.userId, { disabled_kinds: ["return_requested"] })
          const { orderId, gadget } = await orderWithItems({ fulfilled: true })
          const returnId = await requestedReturn(orderId, gadget)
          await sleep(1500) // the real subscriber answers the event first
          sendNotification.mockClear()
          await returnRequestedPushHandler(handlerArgs(getContainer(), "order.return_requested", { order_id: orderId, return_id: returnId }))
          expect(sendNotification).toHaveBeenCalledTimes(1)
          expect(sendNotification.mock.calls[0][0].endpoint).toBe(sub(1).endpoint)
          expect(sentBodies()[0]).toEqual({
            title: "Testshop: Retoure angefragt #1",
            body: "2 Artikel",
            data: { url: `/medusify/orders/${orderId}`, kind: "return_requested", shop: "Testshop", badge: 1 },
            tag: `return-${returnId}`,
          })
        })

        it("a return the app entered itself sends no push (the merchant just did it)", async () => {
          await seed(1, admin.userId)
          const { orderId, gadget } = await orderWithItems({ fulfilled: true })
          const returnId = await requestedReturn(orderId, gadget, { medusify_source: "app" })
          await sleep(1500)
          sendNotification.mockClear()
          await returnRequestedPushHandler(handlerArgs(getContainer(), "order.return_requested", { order_id: orderId, return_id: returnId }))
          expect(sendNotification).not.toHaveBeenCalled()
        })

        it("end to end through the event bus: a customer's return is pushed, one entered by the return route is not", async () => {
          await seed(1, admin.userId)
          const { orderId, widget, gadget } = await orderWithItems({ fulfilled: true })
          await sleep(1500)
          sendNotification.mockClear()
          // positive control first: the same bus does deliver a return that nobody entered in the app
          await requestedReturn(orderId, gadget)
          const end = Date.now() + 15000
          while (!sendNotification.mock.calls.length && Date.now() < end) await sleep(100)
          expect(sendNotification).toHaveBeenCalledTimes(1)
          expect(sentBodies()[0].data.kind).toBe("return_requested")
          sendNotification.mockClear()
          await api.post("/admin/medusify/returns", { order_id: orderId, items: [{ id: widget, quantity: 1 }] }, { headers: admin.headers })
          await sleep(4000)
          expect(sendNotification).not.toHaveBeenCalled()
        })

        it("a push problem on cancel never throws to the event bus", async () => {
          await seed(1, admin.userId)
          const logError = jest.fn()
          const container = getContainer()
          const spy = jest.spyOn(container, "resolve").mockImplementation(((key: string) => {
            if (key === ContainerRegistrationKeys.LOGGER) return { error: logError }
            throw new Error("boom")
          }) as never)
          await expect(orderCanceledPushHandler(handlerArgs(container, "order.canceled", { id: "order_x" }))).resolves.toBeUndefined()
          spy.mockRestore()
          expect(logError.mock.calls.some(([m]) => String(m).includes("push for canceled order order_x failed (ignored): boom"))).toBe(true)
        })
      })

      describe("GET /admin/medusify/permissions", () => {
        it("without roles every action is allowed", async () => {
          const res = await api.get("/admin/medusify/permissions", { headers: admin.headers })
          expect(res.data.actions).toEqual({
            capture: true, mark_paid: true, cancel: true, cancel_refunding: true, deliver: true, refund: true, return: true, ship: true,
            catalog: true, variant_edit: true, product_status: true, stock: true, stock_new_level: true, product_create: true, upload: true, stock_read: true,
            customers: true, discounts: true, discount_create: true, discount_edit: true, manual_order: true, order_edit: true, exchange: true, claim: true, reports: true,
          })
          expect(res.data.rbac).toBe(false) // the app says "no roles in this shop", not "your role may do everything"
        })

        it("needs a login", async () => {
          await expect(api.get("/admin/medusify/permissions")).rejects.toMatchObject({ response: { status: 401 } })
        })
      })
    })
  },
})
