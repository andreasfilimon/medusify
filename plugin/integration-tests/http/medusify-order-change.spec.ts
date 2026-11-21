import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { beginOrderEditOrderWorkflow, beginReceiveReturnWorkflow, cancelBeginOrderEditWorkflow, confirmReturnReceiveWorkflow, receiveItemReturnRequestWorkflow } from "@medusajs/medusa/core-flows"
import { createAdmin } from "../helpers/admin"
import { createCatalogProduct } from "../helpers/catalog"
import { createRegion, fulfillDemoItems } from "../helpers/orders"
import { createShippingSetup } from "../helpers/shipping"

jest.setTimeout(300000)

/** Demo data only: invented buyer, example.invalid addresses. */
medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("changing an order: edit, exchange, claim (Stufe 3)", () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>
      let regionId: string
      let cup: { variantId: string; itemId: string }
      let pot: { variantId: string; itemId: string }
      let orderId: string
      const h = () => ({ headers: admin.headers })
      const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const key = () => `change-${Math.random().toString(36).slice(2, 12)}`
      const post = (path: string, body: unknown) => api.post(path, body, h()).catch((e) => e.response)
      const ok = (res: any, status = 201) => expect(res.status === status ? status : JSON.stringify(res.data)).toBe(status)

      beforeEach(async () => {
        admin = await createAdmin(getContainer())
        regionId = (await createRegion(getContainer(), "eur", "at")).id
        const { locationId } = await createShippingSetup(getContainer())
        const { data: stores } = await query().graph({ entity: "store", fields: ["default_sales_channel_id"] })
        await (getContainer().resolve(ContainerRegistrationKeys.LINK) as any).create({
          [Modules.SALES_CHANNEL]: { sales_channel_id: (stores[0] as any).default_sales_channel_id },
          [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
        })
        const a = await createCatalogProduct(getContainer(), { title: "Demo Tasse", prices: [{ currency_code: "eur", amount: 12.5 }], levels: [{ location_id: locationId, quantity: 10 }] })
        const b = await createCatalogProduct(getContainer(), { title: "Demo Kanne", prices: [{ currency_code: "eur", amount: 20 }], levels: [{ location_id: locationId, quantity: 10 }] })
        cup = { variantId: a.variantId, itemId: a.inventoryItemId! }
        pot = { variantId: b.variantId, itemId: b.inventoryItemId! }
        // a real, paid order with two cups (25.00), made like the app makes one
        const made = await post("/admin/medusify/orders", { region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: cup.variantId, quantity: 2 }], paid: true, idempotency_key: key() })
        ok(made)
        orderId = made.data.order_id
      })

      async function order() {
        const { data } = await query().graph({ entity: "order", fields: ["id", "summary", "items.*", "shipping_methods.*"], filters: { id: orderId } })
        const o = data[0] as any
        return { total: Number(o.summary.current_order_total), pending: Number(o.summary.pending_difference), items: o.items.map((i: any) => ({ id: i.id, variant_id: i.variant_id, quantity: Number(i.quantity) })) }
      }
      async function openChanges() {
        const { data } = await query().graph({ entity: "order_change", fields: ["id", "status"], filters: { order_id: orderId, status: ["pending", "requested"] } })
        return data.length
      }
      const cupLine = async () => (await order()).items.find((i: any) => i.variant_id === cup.variantId)!.id as string
      const edit = async () => ({ kind: "edit", items: [{ id: await cupLine(), quantity: 1 }], add: [{ variant_id: pot.variantId, quantity: 1 }] })

      it("an edit: the preview prices it and changes nothing; the confirmed change makes it, a repeat changes nothing", async () => {
        const change = await edit()
        const p = await post(`/admin/medusify/orders/${orderId}/change/preview`, { change })
        ok(p, 200)
        expect(p.data).toMatchObject({ currency_code: "eur", total_before: 25, total_after: 32.5, difference: 7.5, goods_value: 0 })
        expect(await order()).toMatchObject({ total: 25, pending: 0 })
        expect(await openChanges()).toBe(0)

        const k = key()
        const done = await post(`/admin/medusify/orders/${orderId}/change`, { change, expected_difference: 7.5, idempotency_key: k })
        ok(done)
        expect(done.data).toMatchObject({ kind: "edit", difference: 7.5, replayed: false })
        const after = await order()
        expect(after).toMatchObject({ total: 32.5, pending: 7.5 })
        expect(after.items.map((i: any) => [i.variant_id, i.quantity]).sort()).toEqual([[cup.variantId, 1], [pot.variantId, 1]].sort())
        expect(await openChanges()).toBe(0)

        const again = await post(`/admin/medusify/orders/${orderId}/change`, { change, expected_difference: 7.5, idempotency_key: k })
        ok(again, 200)
        expect(again.data.replayed).toBe(true)
        expect(await order()).toMatchObject({ total: 32.5 })
      })

      it("another difference than the confirmed one changes nothing and leaves no open change", async () => {
        const res = await post(`/admin/medusify/orders/${orderId}/change`, { change: await edit(), expected_difference: 5, idempotency_key: key() })
        expect([res.status, res.data.message]).toEqual([400, "medusify:difference_changed"])
        expect(await order()).toMatchObject({ total: 25, pending: 0 })
        expect(await openChanges()).toBe(0)
      })

      it("an exchange: one cup back, one pot out; the pot is due now, the cup is counted when it is received", async () => {
        // Medusa takes back only what was sent
        await fulfillDemoItems(getContainer(), orderId, [{ id: await cupLine(), quantity: 2 }])
        const change = { kind: "exchange", return_items: [{ id: await cupLine(), quantity: 1 }], add: [{ variant_id: pot.variantId, quantity: 1 }] }
        const p = await post(`/admin/medusify/orders/${orderId}/change/preview`, { change })
        ok(p, 200)
        expect(p.data).toMatchObject({ difference: 20, goods_value: 12.5 })
        ok(await post(`/admin/medusify/orders/${orderId}/change`, { change, expected_difference: 20, idempotency_key: key() }))
        const { data } = await query().graph({ entity: "order_exchange", fields: ["id", "return_id"], filters: { order_id: orderId } })
        expect(data).toHaveLength(1)
        expect((await order()).pending).toBe(20)
        expect(await openChanges()).toBe(0)
        // what the app tells the merchant: once the cup is back, Medusa counts its 12.50 and 7.50 are left
        const returnId = (data[0] as any).return_id as string
        await beginReceiveReturnWorkflow(getContainer()).run({ input: { return_id: returnId } })
        await receiveItemReturnRequestWorkflow(getContainer()).run({ input: { return_id: returnId, items: [{ id: change.return_items[0].id, quantity: 1 }] } })
        await confirmReturnReceiveWorkflow(getContainer()).run({ input: { return_id: returnId } })
        expect((await order()).pending).toBe(7.5)
      })

      it("a claim with refund: a broken cup is recorded; Medusa moves no money, the app names the goods value to refund", async () => {
        const change = { kind: "claim", type: "refund", items: [{ id: await cupLine(), quantity: 1, reason: "production_failure" }] }
        const p = await post(`/admin/medusify/orders/${orderId}/change/preview`, { change })
        ok(p, 200)
        expect(p.data).toMatchObject({ difference: 0, goods_value: 12.5 })
        ok(await post(`/admin/medusify/orders/${orderId}/change`, { change, expected_difference: 0, idempotency_key: key() }))
        const { data } = await query().graph({ entity: "order_claim", fields: ["id", "type"], filters: { order_id: orderId } })
        expect(data.map((c: any) => c.type)).toEqual(["refund"])
        expect((await order()).pending).toBe(0)
      })

      it("a change begun elsewhere (Medusa admin) blocks the app's with its own message", async () => {
        await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } })
        const res = await post(`/admin/medusify/orders/${orderId}/change/preview`, { change: await edit() })
        expect([res.status, res.data.message]).toEqual([400, "medusify:change_open"])
      })

      const operation = async (k: string) => {
        const push: any = getContainer().resolve("medusifyPush")
        const [op] = await push.listMedusifyOperations({ key: k }, { take: 1 })
        return { push, op }
      }

      it("the key is stored before the confirm: a repeat that finds it pending and the change confirmed answers and changes nothing (review 2026-11-20)", async () => {
        const change = await edit()
        const k = key()
        ok(await post(`/admin/medusify/orders/${orderId}/change`, { change, expected_difference: 7.5, idempotency_key: k }))
        // as if the try had stopped after the confirm and before the key was marked done
        const { push, op } = await operation(k)
        expect(op.result).toMatchObject({ state: "done", kind: "edit" })
        await push.updateMedusifyOperations({ id: op.id, result: { ...op.result, state: "pending" } })
        const again = await post(`/admin/medusify/orders/${orderId}/change`, { change, expected_difference: 7.5, idempotency_key: k })
        ok(again, 200)
        expect(again.data).toMatchObject({ replayed: true, difference: 7.5 })
        expect(await order()).toMatchObject({ total: 32.5 })
        expect((await operation(k)).op.result.state).toBe("done")
      })

      it("a key left pending by a try whose change never got confirmed is void: the repeat makes the change once", async () => {
        const change = await edit()
        const k = key()
        // a try that stored its key and stopped: its change was taken back
        const { result: begun } = await beginOrderEditOrderWorkflow(getContainer()).run({ input: { order_id: orderId } })
        await cancelBeginOrderEditWorkflow(getContainer()).run({ input: { order_id: orderId } })
        const push: any = getContainer().resolve("medusifyPush")
        await push.createMedusifyOperations({ key: k, kind: "order_change", result: { order_id: orderId, kind: "edit", currency_code: "eur", total_before: 25, total_after: 32.5, difference: 7.5, goods_value: 0, state: "pending", change_id: (begun as any).id } })
        const res = await post(`/admin/medusify/orders/${orderId}/change`, { change, expected_difference: 7.5, idempotency_key: k })
        ok(res)
        expect(res.data.replayed).toBe(false)
        expect(await order()).toMatchObject({ total: 32.5, pending: 7.5 })
      })

      it("a key of another order is refused", async () => {
        const k = key()
        ok(await post(`/admin/medusify/orders/${orderId}/change`, { change: await edit(), expected_difference: 7.5, idempotency_key: k }))
        const other = await post("/admin/medusify/orders", { region_id: regionId, email: "zweite@example.invalid", items: [{ variant_id: cup.variantId, quantity: 1 }], paid: true, idempotency_key: key() })
        ok(other)
        const res = await post(`/admin/medusify/orders/${other.data.order_id}/change`, { change: { kind: "edit", items: [], add: [{ variant_id: pot.variantId, quantity: 1 }] }, expected_difference: 20, idempotency_key: k })
        expect([res.status, res.data.message]).toEqual([400, "medusify:key_reused"])
      })

      it("refuses a bad body and a missing login", async () => {
        const bad = await post(`/admin/medusify/orders/${orderId}/change`, { change: { kind: "exchange", return_items: [], add: [] }, expected_difference: 0, idempotency_key: key() })
        expect(bad.status).toBe(400)
        const anon = await api.post(`/admin/medusify/orders/${orderId}/change/preview`, { change: { kind: "edit", items: [], add: [] } }).catch((e) => e.response)
        expect(anon.status).toBe(401)
      })
    })
  },
})
