import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { createAdmin } from "../helpers/admin"
import { createDemoOrder, createRegion, fulfillDemoItems, refundDemoOrder } from "../helpers/orders"

jest.setTimeout(180000)

/** Demo orders only: invented items and example.invalid buyers. */
medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("reports (Stufe 4)", () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>
      const h = () => ({ headers: admin.headers })
      const report = (q: string) => api.get(`/admin/medusify/reports?${q}`, h()).catch((e: any) => e.response)
      /** Moves an order to another day: Medusa sets created_at itself, the report reads it. */
      const placedAt = async (id: string, iso: string) => {
        const pg = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
        await pg("order").where({ id }).update({ created_at: iso })
      }
      const linesOf = async (id: string) =>
        (await (getContainer().resolve(ContainerRegistrationKeys.QUERY) as any).graph({ entity: "order", fields: ["items.id", "items.title"], filters: { id } })).data[0].items as { id: string; title: string }[]

      beforeEach(async () => {
        admin = await createAdmin(getContainer())
      })

      it("counts the period and the one before it per currency; refunds come off, unpaid and canceled orders never count", async () => {
        const c = getContainer()
        const eur = (await createRegion(c, "eur", "at")).id
        const usd = (await createRegion(c, "usd", "us")).id
        // current period (1–7 March 2026, Vienna): two paid EUR orders, one refunded by 5; one USD order
        const a = await createDemoOrder(c, { regionId: eur, paid: true, items: [{ title: "Tasse", quantity: 2, unit_price: 19.99 }] }) // 44.98
        const b = await createDemoOrder(c, { regionId: eur, paid: true, items: [{ title: "Teller", quantity: 1, unit_price: 10 }], shipping: 0 }) // 10
        await refundDemoOrder(c, b.id, 5)
        const u = await createDemoOrder(c, { regionId: usd, paid: true, currency: "usd", country: "us", items: [{ title: "Tasse", quantity: 3, unit_price: 7.1 }], shipping: 1 }) // 22.30
        const unpaid = await createDemoOrder(c, { regionId: eur, items: [{ title: "Gratis", quantity: 9, unit_price: 1 }] })
        const gone = await createDemoOrder(c, { regionId: eur, paid: true, items: [{ title: "Weg", quantity: 1, unit_price: 999 }] })
        await cancelOrderWorkflow(c).run({ input: { order_id: gone.id } })
        // previous period (22–28 February): one paid EUR order; one on 1 March 00:30 Vienna (= 28 Feb 23:30 UTC) belongs to the current one
        const prev = await createDemoOrder(c, { regionId: eur, paid: true, items: [{ title: "Tasse", quantity: 1, unit_price: 20 }], shipping: 0 })
        const edge = await createDemoOrder(c, { regionId: eur, paid: true, items: [{ title: "Kanne", quantity: 1, unit_price: 30 }], shipping: 0 })
        // outside both: 21 February
        const old = await createDemoOrder(c, { regionId: eur, paid: true, items: [{ title: "Alt", quantity: 1, unit_price: 50 }], shipping: 0 })
        for (const [o, at] of [[a, "2026-03-02T10:00:00Z"], [b, "2026-03-03T10:00:00Z"], [u, "2026-03-04T10:00:00Z"], [unpaid, "2026-03-04T11:00:00Z"], [gone, "2026-03-05T10:00:00Z"], [prev, "2026-02-25T10:00:00Z"], [edge, "2026-02-28T23:30:00Z"], [old, "2026-02-21T12:00:00Z"]] as const) {
          await placedAt(o.id, at)
        }

        const res = await report("from=2026-03-01&to=2026-03-07&tz=Europe/Vienna")
        expect(res.status === 200 ? 200 : JSON.stringify(res.data)).toBe(200)
        const r = res.data
        expect(r.current).toMatchObject({ from: "2026-03-01", to: "2026-03-07", orders: 4, units: 7 })
        expect(r.current.currencies).toEqual([
          { currency_code: "eur", orders: 3, revenue: 79.98, average: 26.66 }, // 44.98 + (10 − 5) + 30
          { currency_code: "usd", orders: 1, revenue: 22.3, average: 22.3 },
        ])
        expect(r.previous).toMatchObject({ from: "2026-02-22", to: "2026-02-28", orders: 1, units: 1, returned_units: 0 })
        expect(r.previous.currencies).toEqual([{ currency_code: "eur", orders: 1, revenue: 20, average: 20 }])
        // top products by units, the revenue of their lines per currency
        expect(r.top_products.map((t: any) => [t.title, t.units])).toEqual([["Tasse", 5], ["Kanne", 1], ["Teller", 1]])
        expect(r.top_products[0].revenue).toEqual([{ currency_code: "eur", amount: 39.98 }, { currency_code: "usd", amount: 21.3 }])
      })

      it("counts returned units of received returns", async () => {
        const c = getContainer()
        const eur = (await createRegion(c, "eur", "at")).id
        const o = await createDemoOrder(c, { regionId: eur, paid: true, items: [{ title: "Tasse", quantity: 4, unit_price: 10 }], shipping: 0 })
        const [line] = await linesOf(o.id)
        await fulfillDemoItems(c, o.id, [{ id: line!.id, quantity: 4 }])
        const ret = await api.post("/admin/medusify/returns", { order_id: o.id, items: [{ id: line!.id, quantity: 1 }] }, h()).catch((e: any) => e.response)
        expect(ret.status === 201 ? 201 : JSON.stringify(ret.data)).toBe(201)
        const today = new Date().toISOString().slice(0, 10)
        const r = (await report(`from=${today}&to=${today}&tz=UTC`)).data
        expect(r.current).toMatchObject({ orders: 1, units: 4, returned_units: 1 })
      })

      it("refuses a bad period, a period too long and a missing login", async () => {
        expect((await report("from=2026-03-07&to=2026-03-01")).data.message).toBe("medusify:bad_period")
        expect((await report("from=2026-02-30&to=2026-03-01")).data.message).toBe("medusify:bad_date")
        expect((await report("from=2024-01-01&to=2026-01-01")).data.message).toBe("medusify:period_too_long")
        expect((await report("from=2026-03-01")).status).toBe(400)
        expect((await report("from=2026-03-01&to=2026-03-07&tz=Mars/Base")).status).toBe(400)
        expect((await api.get("/admin/medusify/reports?from=2026-03-01&to=2026-03-07").catch((e: any) => e.response)).status).toBe(401)
      })
    })
  },
})
