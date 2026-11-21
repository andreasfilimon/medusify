import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createShippingOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { createAdmin } from "../helpers/admin"
import { createCatalogProduct } from "../helpers/catalog"
import { createRegion } from "../helpers/orders"
import { createShippingSetup } from "../helpers/shipping"

jest.setTimeout(240000)

/** Demo data only: invented buyer, example.invalid addresses. */
medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("an order taken by hand (Stufe 3)", () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>
      let regionId: string
      let variantId: string
      let itemId: string
      let locationId: string
      let flatOption: string
      const h = () => ({ headers: admin.headers })
      const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
      let n = 0
      const key = () => `manual-${++n}-${Math.random().toString(36).slice(2, 10)}`
      const address = { first_name: "Demo", last_name: "Kundin", address_1: "Teststrasse 3", postal_code: "1010", city: "Wien", country_code: "at" }

      beforeEach(async () => {
        admin = await createAdmin(getContainer())
        regionId = (await createRegion(getContainer(), "eur", "at")).id
        const setup = await createShippingSetup(getContainer())
        locationId = setup.locationId
        const p = await createCatalogProduct(getContainer(), { title: "Demo Tasse", levels: [{ location_id: locationId, quantity: 10 }] })
        variantId = p.variantId
        itemId = p.inventoryItemId!
        // as in a real shop: the store's sales channel sells from this location (Medusa refuses a reservation otherwise)
        const { data: stores } = await query().graph({ entity: "store", fields: ["default_sales_channel_id"] })
        await (getContainer().resolve(ContainerRegistrationKeys.LINK) as any).create({
          [Modules.SALES_CHANNEL]: { sales_channel_id: (stores[0] as any).default_sales_channel_id },
          [Modules.STOCK_LOCATION]: { stock_location_id: locationId },
        })
        const fm = getContainer().resolve(Modules.FULFILLMENT) as any
        const [zone] = await fm.listServiceZones({}, { take: 1 })
        const [profile] = await fm.listShippingProfiles({}, { take: 1 })
        const { result } = await createShippingOptionsWorkflow(getContainer()).run({
          input: [
            {
              name: "Abholung oder Paket",
              price_type: "flat",
              service_zone_id: zone.id,
              shipping_profile_id: profile.id,
              provider_id: "manual_manual",
              type: { label: "Paket", description: "Paket", code: "paket-hand" },
              // a price for this region wins over the plain euro price
              prices: [{ currency_code: "eur", amount: 4.9 }, { region_id: regionId, amount: 3.9 }],
              rules: [],
            } as any,
          ],
        })
        flatOption = result[0]!.id
      })

      async function orderOf(id: string) {
        const { data } = await query().graph({
          entity: "order",
          fields: ["id", "status", "is_draft_order", "email", "customer_id", "sales_channel_id", "total", "items.quantity", "items.variant_id", "shipping_methods.amount", "shipping_address.city", "payment_collections.amount", "payment_collections.status"],
          filters: { id },
        })
        return data[0] as any
      }
      async function reserved() {
        const { data } = await query().graph({ entity: "reservation_item", fields: ["quantity"], filters: { inventory_item_id: itemId } })
        return (data as any[]).reduce((s, r) => s + Number(r.quantity), 0)
      }
      const create = (body: Record<string, unknown>) => api.post("/admin/medusify/orders", body, h()).catch((e) => e.response)

      it("makes a real order: the variant's price, the region's shipping price, the stock reserved, a payment collection for the total", async () => {
        const res = await create({ region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 2 }], shipping_option_id: flatOption, shipping_address: address, idempotency_key: key() })
        expect(res.status === 201 ? 201 : JSON.stringify(res.data)).toBe(201)
        expect(res.data).toMatchObject({ order_id: expect.any(String), display_id: expect.any(Number), replayed: false })
        const order = await orderOf(res.data.order_id)
        expect(order).toMatchObject({ status: "pending", is_draft_order: false, email: "kundin@example.invalid", shipping_address: { city: "Wien" } })
        expect(order.items.map((i: any) => [i.variant_id, Number(i.quantity)])).toEqual([[variantId, 2]])
        expect(order.shipping_methods.map((m: any) => Number(m.amount))).toEqual([3.9])
        expect(Number(order.total)).toBeCloseTo(28.9, 2)
        expect(order.payment_collections.map((c: any) => [Number(c.amount), c.status])).toEqual([[28.9, "not_paid"]])
        expect(await reserved()).toBe(2)
      })

      it("paid at once: the payment collection is marked as paid", async () => {
        const res = await create({ region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 1 }], paid: true, idempotency_key: key() })
        expect(res.status === 201 ? 201 : JSON.stringify(res.data)).toBe(201)
        const order = await orderOf(res.data.order_id)
        expect(order.payment_collections.map((c: any) => c.status)).toEqual(["completed"])
      })

      it("a free order (price 0, pick-up) gets no payment collection", async () => {
        const free = await createCatalogProduct(getContainer(), { title: "Gratis Probe", prices: [{ currency_code: "eur", amount: 0 }], levels: [{ location_id: locationId, quantity: 5 }] })
        const res = await create({ region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: free.variantId, quantity: 1 }], paid: true, idempotency_key: key() })
        expect(res.status === 201 ? 201 : JSON.stringify(res.data)).toBe(201)
        const order = await orderOf(res.data.order_id)
        expect(Number(order.total)).toBe(0)
        expect(order.payment_collections ?? []).toEqual([])
      })

      it("a repeat with the same key answers with the same order and makes no second one", async () => {
        const k = key()
        const body = { region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 1 }], idempotency_key: k }
        const [a, b] = await Promise.all([create(body), create(body)])
        expect([a.status, b.status].sort()).toEqual([200, 201])
        expect(a.data.order_id).toBe(b.data.order_id)
        const { data } = await query().graph({ entity: "order", fields: ["id"], filters: { email: "kundin@example.invalid" } })
        expect(data).toHaveLength(1)
        expect(await reserved()).toBe(1)
      })

      // A try that stopped half-way (review 2026-11-20): the key is taken before the order is made and travels in its metadata.
      const push = () => getContainer().resolve("medusifyPush") as any
      const record = async (k: string) => (await push().listMedusifyOperations({ key: k }, { take: 1 }))[0]
      const attempt = (k: string) => api.get(`/admin/medusify/orders/attempts/${k}`, h()).catch((e) => e.response)
      const ordersByMail = async (email: string) => (await query().graph({ entity: "order", fields: ["id"], filters: { email } })).data

      it("the key travels in the order and is done once the order is made; the shop says so when asked", async () => {
        const k = key()
        const res = await create({ region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 1 }], paid: true, idempotency_key: k })
        expect(res.status === 201 ? 201 : JSON.stringify(res.data)).toBe(201)
        const { data } = await query().graph({ entity: "order", fields: ["metadata"], filters: { id: res.data.order_id } })
        expect((data[0] as any).metadata).toMatchObject({ medusify_key: k })
        expect((await record(k)).result).toMatchObject({ state: "done", order_id: res.data.order_id })
        const asked = await attempt(k)
        expect([asked.status, asked.data]).toEqual([200, { state: "done", order_id: res.data.order_id, display_id: res.data.display_id }])
        expect((await attempt(key())).data).toEqual({ state: "none" })
      })

      it("a repeat that finds the key pending and the order complete answers with it and makes no second one", async () => {
        const k = key()
        const body = { region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 1 }], paid: true, idempotency_key: k }
        const first = await create(body)
        const op = await record(k)
        await push().updateMedusifyOperations({ id: op.id, result: { state: "pending", paid: true } })
        const again = await create(body)
        expect([again.status, again.data]).toEqual([200, { order_id: first.data.order_id, display_id: first.data.display_id, replayed: true, incomplete: false }])
        expect(await ordersByMail("kundin@example.invalid")).toHaveLength(1)
        expect((await record(k)).result.state).toBe("done")
      })

      it("a try that stopped before marking it paid: the repeat answers with the order as incomplete, never as done, never a second one", async () => {
        const k = key()
        const first = await create({ region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 1 }], paid: false, idempotency_key: k })
        const op = await record(k)
        // as if the try had been asked to mark it paid and stopped before that step
        await push().updateMedusifyOperations({ id: op.id, result: { state: "pending", paid: true } })
        const again = await create({ region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 1 }], paid: true, idempotency_key: k })
        expect([again.status, again.data]).toEqual([200, { order_id: first.data.order_id, display_id: first.data.display_id, replayed: true, incomplete: true }])
        expect((await attempt(k)).data).toEqual({ state: "incomplete", order_id: first.data.order_id, display_id: first.data.display_id })
        expect(await ordersByMail("kundin@example.invalid")).toHaveLength(1)
      })

      it("a try that stopped before the order existed is void: asking says none, the next send makes the order once", async () => {
        const k = key()
        await push().createMedusifyOperations({ key: k, kind: "manual_order", result: { state: "pending", paid: false } })
        expect((await attempt(k)).data).toEqual({ state: "none" })
        expect(await record(k)).toBeUndefined()
        const res = await create({ region_id: regionId, email: "kundin@example.invalid", items: [{ variant_id: variantId, quantity: 1 }], idempotency_key: k })
        expect(res.status).toBe(201)
        expect(await ordersByMail("kundin@example.invalid")).toHaveLength(1)
      })

      it("asking needs a login and a key of sane length", async () => {
        expect((await api.get(`/admin/medusify/orders/attempts/${key()}`).catch((e) => e.response)).status).toBe(401)
        expect((await attempt("short")).status).toBe(400)
      })

      it("for a chosen customer the customer's email is used", async () => {
        const customer = await (getContainer().resolve(Modules.CUSTOMER) as any).createCustomers({ email: "stamm@example.invalid", first_name: "Stamm", has_account: true })
        const res = await create({ region_id: regionId, customer_id: customer.id, items: [{ variant_id: variantId, quantity: 1 }], idempotency_key: key() })
        expect(res.status === 201 ? 201 : JSON.stringify(res.data)).toBe(201)
        expect(await orderOf(res.data.order_id)).toMatchObject({ email: "stamm@example.invalid", customer_id: customer.id })
      })

      it("refuses before anything is made: no email, an unknown region, a shipping option without a price for the currency", async () => {
        const base = { items: [{ variant_id: variantId, quantity: 1 }] }
        const noMail = await create({ ...base, region_id: regionId, idempotency_key: key() })
        expect([noMail.status, noMail.data.message]).toEqual([400, "medusify:email_required"])
        const noRegion = await create({ ...base, region_id: "reg_nope", email: "kundin@example.invalid", idempotency_key: key() })
        expect([noRegion.status, noRegion.data.message]).toEqual([404, "medusify:no_region"])
        const usd = (await createRegion(getContainer(), "usd", "us")).id
        const noPrice = await create({ ...base, region_id: usd, email: "kundin@example.invalid", shipping_option_id: flatOption, idempotency_key: key() })
        expect([noPrice.status, noPrice.data.message]).toEqual([400, "medusify:shipping_no_price"])
        const { data } = await query().graph({ entity: "order", fields: ["id"], filters: {} })
        expect(data).toHaveLength(0)
        expect(await reserved()).toBe(0)
      })

      it("the form gets the regions and the flat options with the price per region; return options are left out", async () => {
        const fm = getContainer().resolve(Modules.FULFILLMENT) as any
        const [zone] = await fm.listServiceZones({}, { take: 1 })
        const [profile] = await fm.listShippingProfiles({}, { take: 1 })
        await createShippingOptionsWorkflow(getContainer()).run({
          input: [
            {
              name: "Ruecksendung", price_type: "flat", service_zone_id: zone.id, shipping_profile_id: profile.id, provider_id: "manual_manual",
              type: { label: "R", description: "R", code: "retour" }, prices: [{ currency_code: "eur", amount: 0 }],
              rules: [{ attribute: "is_return", operator: "eq", value: "true" }],
            } as any,
          ],
        })
        const res = await api.get("/admin/medusify/orders/setup", h())
        expect(res.status).toBe(200)
        const region = res.data.regions.find((r: any) => r.id === regionId)
        expect(region).toMatchObject({ currency_code: "eur", countries: [{ iso_2: "at" }] })
        const names = res.data.shipping_options.map((o: any) => o.name)
        expect(names).toContain("Abholung oder Paket")
        expect(names).not.toContain("Ruecksendung")
        expect(res.data.shipping_options.find((o: any) => o.id === flatOption).prices[regionId]).toBe(3.9)
      })

      it("needs a login", async () => {
        const res = await api.post("/admin/medusify/orders", { region_id: regionId }).catch((e) => e.response)
        expect(res.status).toBe(401)
        const setup = await api.get("/admin/medusify/orders/setup").catch((e) => e.response)
        expect(setup.status).toBe(401)
      })
    })
  },
})
