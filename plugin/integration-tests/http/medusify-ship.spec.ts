import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createOrderFulfillmentWorkflow, createOrderShipmentWorkflow, markOrderFulfillmentAsDeliveredWorkflow } from "@medusajs/medusa/core-flows"
import { createAdmin } from "../helpers/admin"
import { createDemoOrder, createRegion, listedStatuses } from "../helpers/orders"
import { createShippingSetup } from "../helpers/shipping"
import { hasUnsentRest, REST_FIELDS } from "../../src/lib/dashboard"

jest.setTimeout(180000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("POST /admin/medusify/orders/:id/ship", () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>
      let regionId: string
      let setup: Awaited<ReturnType<typeof createShippingSetup>>
      const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)

      beforeEach(async () => {
        admin = await createAdmin(getContainer())
        regionId = (await createRegion(getContainer(), "eur", "at")).id
        setup = await createShippingSetup(getContainer())
      })

      const paidOrder = (items?: { title: string; quantity: number; unit_price: number; requires_shipping?: boolean }[]) =>
        createDemoOrder(getContainer(), {
          regionId,
          paid: true,
          shippingOptionId: setup.options[0]!.optionId,
          // Goods from a product ship; a custom line without the flag would count as "no shipping".
          items: items ?? [{ title: "Widget", quantity: 2, unit_price: 19.99, requires_shipping: true }],
        })

      async function fulfillments(orderId: string) {
        const {
          data: [o],
        } = await query().graph({
          entity: "order",
          fields: ["fulfillments.id", "fulfillments.shipped_at", "fulfillments.delivered_at", "fulfillments.labels.tracking_number", "fulfillments.labels.tracking_url", "fulfillments.labels.label_url"],
          filters: { id: orderId },
        })
        return o.fulfillments as any[]
      }

      const ship = (orderId: string, body: Record<string, unknown>) => api.post(`/admin/medusify/orders/${orderId}/ship`, body, { headers: admin.headers })

      it("ships an unfulfilled order in one request and a repeat changes nothing", async () => {
        const order = await paidOrder()
        const res = await ship(order.id, { notify: false, tracking_number: "TRK-1" })
        expect(res.status).toBe(200)
        expect(res.data).toEqual({ order_id: order.id, shipped: [{ fulfillment_id: expect.any(String), tracking_numbers: ["TRK-1"] }], delivered: [], nothing_to_do: false, unused_tracking_number: false })
        expect((await listedStatuses(getContainer(), order.id)).fulfillment_status).toBe("shipped")

        const again = await ship(order.id, { notify: false, tracking_number: "TRK-1" })
        expect(again.status).toBe(200)
        // The number is on the shipped package already: not reported as unused.
        expect(again.data).toEqual({ order_id: order.id, shipped: [], delivered: [], nothing_to_do: true, unused_tracking_number: false })
        // A different number after the order went out goes nowhere, and the answer says so.
        const changed = await ship(order.id, { notify: false, tracking_number: "TRK-OTHER" })
        expect(changed.data).toMatchObject({ nothing_to_do: true, unused_tracking_number: true })
        expect(await fulfillments(order.id)).toHaveLength(1)
      })

      it("two ship requests at once (a double tap, a second phone) give one package and one shipment", async () => {
        const order = await paidOrder()
        const [a, b] = await Promise.all([ship(order.id, { notify: false, tracking_number: "TRK-A" }), ship(order.id, { notify: false, tracking_number: "TRK-A" })])
        expect([a.status, b.status]).toEqual([200, 200])
        expect([a.data.nothing_to_do, b.data.nothing_to_do].sort()).toEqual([false, true])
        const fs = await fulfillments(order.id)
        expect(fs).toHaveLength(1)
        expect(fs[0].shipped_at).toBeTruthy()
      })

      it("two packages packed earlier and one typed number: nothing is shipped until each package has its number", async () => {
        const order = await paidOrder([
          { title: "Widget", quantity: 1, unit_price: 10, requires_shipping: true },
          { title: "Gadget", quantity: 1, unit_price: 12, requires_shipping: true },
        ])
        const {
          data: [o],
        } = await query().graph({ entity: "order", fields: ["items.id", "items.title"], filters: { id: order.id } })
        const ids: string[] = []
        for (const item of o.items) {
          const { result } = await createOrderFulfillmentWorkflow(getContainer()).run({ input: { order_id: order.id, items: [{ id: item.id, quantity: 1 }], no_notification: true } })
          ids.push((result as any).id)
        }
        const refused = await ship(order.id, { notify: false, tracking_number: "ONE-FOR-ALL" }).catch((e: any) => e.response)
        expect(refused.status).toBe(400)
        expect(refused.data.message).toBe("medusify:numbers_required")
        expect((await fulfillments(order.id)).every((f) => !f.shipped_at)).toBe(true)

        const res = await ship(order.id, { notify: false, tracking_url: "https://carrier.invalid/main", numbers: { [ids[0]!]: "PKG-1", [ids[1]!]: "PKG-2" } })
        expect(res.status).toBe(200)
        // The link belongs to the typed main number; packages with numbers of their own do not get it.
        expect((await fulfillments(order.id)).flatMap((f) => f.labels.map((l: any) => l.tracking_url))).toEqual(["", ""])
        expect(Object.fromEntries(res.data.shipped.map((x: any) => [x.fulfillment_id, x.tracking_numbers]))).toEqual({ [ids[0]!]: ["PKG-1"], [ids[1]!]: ["PKG-2"] })
      })

      it("finishes a packed order and keeps the label a carrier wrote (the order left behind by an interrupted app)", async () => {
        const order = await paidOrder()
        const {
          data: [o],
        } = await query().graph({ entity: "order", fields: ["items.id", "items.quantity"], filters: { id: order.id } })
        const { result } = await createOrderFulfillmentWorkflow(getContainer()).run({
          input: { order_id: order.id, items: o.items.map((i: any) => ({ id: i.id, quantity: i.quantity })), no_notification: true },
        })
        // What a carrier integration does in createFulfillment: a label with its own number, a relative PDF path.
        await (getContainer().resolve(Modules.FULFILLMENT) as any).updateFulfillment((result as any).id, {
          labels: [{ tracking_number: "900000000017", tracking_url: "https://carrier.invalid/track/900000000017", label_url: "/api/v1/shipments/x/pdf" }],
        })

        const res = await ship(order.id, { notify: false })
        expect(res.status).toBe(200)
        expect(res.data.shipped).toEqual([{ fulfillment_id: (result as any).id, tracking_numbers: ["900000000017"] }])
        const [f] = await fulfillments(order.id)
        expect(f.shipped_at).toBeTruthy()
        expect(f.labels.map((l: any) => [l.tracking_number, l.tracking_url, l.label_url])).toEqual([["900000000017", "https://carrier.invalid/track/900000000017", "/api/v1/shipments/x/pdf"]])
      })

      it("adds a typed number next to the carrier label instead of replacing it", async () => {
        const order = await paidOrder()
        const {
          data: [o],
        } = await query().graph({ entity: "order", fields: ["items.id", "items.quantity"], filters: { id: order.id } })
        const { result } = await createOrderFulfillmentWorkflow(getContainer()).run({
          input: { order_id: order.id, items: o.items.map((i: any) => ({ id: i.id, quantity: i.quantity })), no_notification: true },
        })
        await (getContainer().resolve(Modules.FULFILLMENT) as any).updateFulfillment((result as any).id, {
          labels: [{ tracking_number: "CARRIER-1", tracking_url: "", label_url: "" }],
        })
        const res = await ship(order.id, { notify: false, tracking_number: "TYPED-2" })
        expect(res.data.shipped[0].tracking_numbers).toEqual(["CARRIER-1", "TYPED-2"])
        expect((await fulfillments(order.id))[0].labels.map((l: any) => l.tracking_number).sort()).toEqual(["CARRIER-1", "TYPED-2"])
      })

      it("splits goods to ship from goods without shipping, as Medusa requires", async () => {
        const order = await paidOrder([
          { title: "Widget", quantity: 1, unit_price: 10, requires_shipping: true },
          { title: "Gutschein", quantity: 1, unit_price: 20, requires_shipping: false },
        ])
        const res = await ship(order.id, { notify: false, tracking_number: "TRK-2" })
        expect(res.status).toBe(200)
        expect(res.data.shipped).toHaveLength(1)
        expect(res.data.delivered).toHaveLength(1)
        const fs = await fulfillments(order.id)
        expect(fs).toHaveLength(2)
        expect(fs.every((f) => f.shipped_at || f.delivered_at)).toBe(true)
        // Medusa calls this finished order partially_delivered (the voucher is delivered, the goods are shipped), and
        // nothing is left to send: the dashboard must not count it (measured 2026-11-19).
        const {
          data: [after],
        } = await query().graph({ entity: "order", fields: ["items.title", ...REST_FIELDS], filters: { id: order.id } })
        expect(after.items.map((i: any) => [i.title, i.quantity, i.detail.shipped_quantity, i.detail.delivered_quantity]).sort()).toEqual([["Gutschein", 1, 0, 1], ["Widget", 1, 1, 0]])
        expect((await listedStatuses(getContainer(), order.id)).fulfillment_status).toBe("partially_delivered")
        expect(hasUnsentRest(after.items)).toBe(false)
      })

      it("counts a delivered voucher next to goods still to send as to ship, and the finished order not", async () => {
        const order = await paidOrder([
          { title: "Widget", quantity: 1, unit_price: 10, requires_shipping: true },
          { title: "Gutschein", quantity: 1, unit_price: 20, requires_shipping: false },
        ])
        const {
          data: [o],
        } = await query().graph({ entity: "order", fields: ["items.id", "items.title"], filters: { id: order.id } })
        const voucher = o.items.find((i: any) => i.title === "Gutschein")
        const { result } = await createOrderFulfillmentWorkflow(getContainer()).run({ input: { order_id: order.id, items: [{ id: voucher.id, quantity: 1 }], no_notification: true } })
        await markOrderFulfillmentAsDeliveredWorkflow(getContainer()).run({ input: { orderId: order.id, fulfillmentId: (result as any).id } as any })
        expect((await listedStatuses(getContainer(), order.id)).fulfillment_status).toBe("partially_delivered")

        // Medusa's list (the dashboard's source) even reads this order as "delivered"; the line details count it.
        const dashboard = async () => (await api.get(`/admin/medusify/dashboard?tz=Europe/Vienna`, { headers: admin.headers })).data
        const before = await dashboard()
        expect(before.to_ship).toBe(1)
        expect(before.recent_orders.find((r: any) => r.id === order.id).unsent_rest).toBe(true)

        const res = await ship(order.id, { notify: false, tracking_number: "TRK-3" })
        expect(res.data.shipped).toHaveLength(1)
        expect(res.data.delivered).toEqual([])
        const after = await dashboard()
        expect(after.to_ship).toBe(0)
        expect(after.recent_orders.find((r: any) => r.id === order.id).unsent_rest).toBe(false)
      })

      it("an unknown route under the plugin answers 404, which the app reads as an older plugin without the ship route", async () => {
        const order = await paidOrder()
        const res = await api.post(`/admin/medusify/orders/${order.id}/no-such-route`, {}, { headers: admin.headers }).catch((e: any) => e.response)
        expect(res.status).toBe(404)
      })

      it("a voucher packed now next to a parcel packed earlier: the typed number goes on the parcel, the link with it", async () => {
        const order = await paidOrder([
          { title: "Widget", quantity: 1, unit_price: 10, requires_shipping: true },
          { title: "Gutschein", quantity: 1, unit_price: 20, requires_shipping: false },
        ])
        const {
          data: [o],
        } = await query().graph({ entity: "order", fields: ["items.id", "items.title"], filters: { id: order.id } })
        const widget = o.items.find((i: any) => i.title === "Widget")
        const { result } = await createOrderFulfillmentWorkflow(getContainer()).run({ input: { order_id: order.id, items: [{ id: widget.id, quantity: 1 }], no_notification: true } })
        const res = await ship(order.id, { notify: false, tracking_number: "PARCEL-1", tracking_url: "https://carrier.invalid/PARCEL-1" })
        expect(res.data).toMatchObject({ shipped: [{ fulfillment_id: (result as any).id, tracking_numbers: ["PARCEL-1"] }], unused_tracking_number: false })
        expect(res.data.delivered).toHaveLength(1)
        const parcel = (await fulfillments(order.id)).find((f) => f.id === (result as any).id)
        expect(parcel.labels.map((l: any) => [l.tracking_number, l.tracking_url])).toEqual([["PARCEL-1", "https://carrier.invalid/PARCEL-1"]])
      })

      it("a repeat after a failure half way does not put the first package's number on the second", async () => {
        const order = await paidOrder([
          { title: "Widget", quantity: 1, unit_price: 10, requires_shipping: true },
          { title: "Gadget", quantity: 1, unit_price: 12, requires_shipping: true },
        ])
        const {
          data: [o],
        } = await query().graph({ entity: "order", fields: ["items.id", "items.quantity"], filters: { id: order.id } })
        const ids: string[] = []
        for (const item of o.items) {
          const { result } = await createOrderFulfillmentWorkflow(getContainer()).run({ input: { order_id: order.id, items: [{ id: item.id, quantity: 1 }], no_notification: true } })
          ids.push((result as any).id)
        }
        // The first try shipped package 1 with "FIRST" and broke before package 2.
        await createOrderShipmentWorkflow(getContainer()).run({
          input: { order_id: order.id, fulfillment_id: ids[0]!, items: [{ id: o.items[0].id, quantity: 1 }], labels: [{ tracking_number: "FIRST", tracking_url: "", label_url: "" }], no_notification: true },
        })
        const res = await ship(order.id, { notify: false, tracking_number: "FIRST" })
        expect(res.data.shipped).toEqual([{ fulfillment_id: ids[1], tracking_numbers: [] }])
        expect(res.data.unused_tracking_number).toBe(false)
      })

      it("a digital order without any shipping method: the voucher is marked as delivered", async () => {
        const order = await createDemoOrder(getContainer(), { regionId, paid: true, noShippingMethod: true, items: [{ title: "Gutschein", quantity: 1, unit_price: 20, requires_shipping: false }] })
        const res = await ship(order.id, { notify: false }).catch((e: any) => e.response)
        expect(res.status).toBe(200)
        expect(res.data.delivered).toHaveLength(1)
      })

      it("rejects a tracking URL that is not http(s)", async () => {
        const order = await paidOrder()
        const res = await ship(order.id, { notify: false, tracking_number: "T", tracking_url: "javascript:alert(1)" }).catch((e: any) => e.response)
        expect(res.status).toBe(400)
        expect(await fulfillments(order.id)).toHaveLength(0)
      })
    })
  },
})
