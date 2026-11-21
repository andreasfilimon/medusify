import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { Modules } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { createAdmin } from "../helpers/admin"
import { createDemoOrder, createRegion, refundDemoOrder } from "../helpers/orders"

jest.setTimeout(180000)

/** Demo customers only: invented names and example.invalid addresses. */
medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("customers (Stufe 3)", () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>
      let regionId: string
      const h = () => ({ headers: admin.headers })
      const customers = () => getContainer().resolve(Modules.CUSTOMER) as any

      beforeEach(async () => {
        admin = await createAdmin(getContainer())
        regionId = (await createRegion(getContainer(), "eur", "at")).id
      })

      it("lists customers newest first with order count, spend and last order; canceled and unpaid orders count as the dashboard counts them", async () => {
        const anna = await customers().createCustomers({ email: "anna@example.invalid", first_name: "Anna", last_name: "Demo", has_account: true })
        const ben = await customers().createCustomers({ email: "ben@example.invalid", first_name: "Ben", last_name: "Probe" })
        // Anna: two paid orders (44.98 each), one of them 5 refunded; one unpaid; one canceled
        const paid1 = await createDemoOrder(getContainer(), { regionId, paid: true, customerId: anna.id })
        await createDemoOrder(getContainer(), { regionId, paid: true, customerId: anna.id })
        await refundDemoOrder(getContainer(), paid1.id, 5)
        const unpaid = await createDemoOrder(getContainer(), { regionId, customerId: anna.id })
        const gone = await createDemoOrder(getContainer(), { regionId, customerId: anna.id })
        await cancelOrderWorkflow(getContainer()).run({ input: { order_id: gone.id } })

        const res = await api.get("/admin/medusify/customers", h())
        expect(res.status).toBe(200)
        expect(res.data.count).toBe(2)
        expect(res.data.customers.map((c: any) => c.email)).toEqual(["ben@example.invalid", "anna@example.invalid"])
        const [b, a] = res.data.customers
        expect(b).toMatchObject({ id: ben.id, first_name: "Ben", has_account: false, stats: { orders: 0, spent: [], last_order_at: null, order_name: null } })
        expect(a).toMatchObject({ id: anna.id, first_name: "Anna", last_name: "Demo", has_account: true })
        expect(a.stats.orders).toBe(3)
        expect(a.stats.order_name).toBe("Demo Buyer")
        expect(a.stats.spent).toEqual([{ currency_code: "eur", amount: 84.96 }])
        expect(new Date(a.stats.last_order_at).getTime()).toBe(new Date(unpaid.created_at).getTime())
      })

      it("searches name, email and company; pages", async () => {
        await customers().createCustomers({ email: "c1@example.invalid", first_name: "Clara", company_name: "Demo Holz GmbH" })
        await customers().createCustomers({ email: "d1@example.invalid", first_name: "Dora" })
        await customers().createCustomers({ email: "e1@example.invalid", first_name: "Emil" })
        expect((await api.get("/admin/medusify/customers?q=holz", h())).data.customers.map((c: any) => c.first_name)).toEqual(["Clara"])
        expect((await api.get("/admin/medusify/customers?q=dora", h())).data.customers.map((c: any) => c.first_name)).toEqual(["Dora"])
        expect((await api.get("/admin/medusify/customers?q=e1%40example", h())).data.customers.map((c: any) => c.first_name)).toEqual(["Emil"])
        const page = (await api.get("/admin/medusify/customers?limit=2&offset=2", h())).data
        expect(page).toMatchObject({ count: 3, offset: 2, limit: 2 })
        expect(page.customers.map((c: any) => c.first_name)).toEqual(["Clara"])
      })

      it("the profile has addresses and groups; an unknown id is 404", async () => {
        const c = await customers().createCustomers({
          email: "f1@example.invalid",
          first_name: "Fritz",
          addresses: [{ first_name: "Fritz", last_name: "Demo", address_1: "Teststrasse 2", city: "Wien", postal_code: "1010", country_code: "at", is_default_shipping: true }],
        })
        const group = await customers().createCustomerGroups({ name: "Stammkunden" })
        await customers().addCustomerToGroup({ customer_id: c.id, customer_group_id: group.id })
        // a guest: the order email has to be the customer's, or Medusa files the order under another guest customer
        await createDemoOrder(getContainer(), { regionId, paid: true, customerId: c.id, email: "f1@example.invalid" })

        const res = await api.get(`/admin/medusify/customers/${c.id}`, h())
        expect(res.data.customer).toMatchObject({ id: c.id, email: "f1@example.invalid", stats: { orders: 1, spent: [{ currency_code: "eur", amount: 44.98 }] } })
        expect(res.data.customer.addresses).toEqual([expect.objectContaining({ address_1: "Teststrasse 2", city: "Wien", country_code: "at", is_default_shipping: true, is_default_billing: false })])
        expect(res.data.customer.groups).toEqual([{ id: group.id, name: "Stammkunden" }])

        const missing = await api.get("/admin/medusify/customers/cus_nope", h()).catch((e) => e.response)
        expect(missing.status).toBe(404)
        expect(missing.data.message).toBe("medusify:no_customer")
      })

      it("needs a login", async () => {
        const res = await api.get("/admin/medusify/customers").catch((e) => e.response)
        expect(res.status).toBe(401)
      })
    })
  },
})
