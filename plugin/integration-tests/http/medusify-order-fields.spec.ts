import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Modules } from "@medusajs/framework/utils"
import { createOrderWorkflow, createProductsWorkflow, createShippingProfilesWorkflow } from "@medusajs/medusa/core-flows"
import { createAdmin } from "../helpers/admin"
import { createRegion } from "../helpers/orders"
import { rbacRunner } from "../helpers/rbac-license"

// Sets the throw-away license before the runner loads medusa-config.ts (it adds the licensed RBAC module only then).
const runner = rbacRunner()

jest.setTimeout(120 * 1000)

/**
 * The app reads an order with one field list (ORDER_FIELDS in pwa/src/lib/api.ts, read from the source here so the two
 * cannot drift). It includes the inventory links of the variant (`required_quantity`), which the app needs to count a
 * kit line in a fulfillment. This pins how Medusa's role-based access treats that list: an admin who may read orders
 * but not inventory gets 200 and the order without the linked variant fields (no error; the lines themselves stay), so the
 * app must work without them (`lineUnits` in the app derives the ratio from the order itself then).
 */
const source = readFileSync(join(__dirname, "../../../pwa/src/lib/api.ts"), "utf8")
const block = source.slice(source.indexOf("export const ORDER_FIELDS = ["), source.indexOf('].join(",")'))
const ORDER_FIELDS = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).join(",")

runner({
  testSuite: ({ api, getContainer }) => {
    describe("the order screen's field list under Medusa RBAC", () => {
      it("answers 200 for a reader of orders, without the variant's inventory links; a role that may read all has them", async () => {
        expect(ORDER_FIELDS).toContain("items.variant.inventory_items.required_quantity")
        const container = getContainer()
        const rbac = container.resolve(Modules.RBAC) as any
        const role = async (userId: string, name: string, operationFilter: (p: { resource: string }) => boolean) => {
          const created = await rbac.createRbacRoles({ name })
          for (const policy of (await rbac.listRbacPolicies({ operation: "read" })).filter(operationFilter)) {
            await rbac.createRbacRolePolicies({ role_id: created.id, policy_id: policy.id })
          }
          await rbac.createRbacRoleAssignments({ role_id: created.id, reference: "user", reference_id: userId })
        }
        // roles first, before any request: Medusa caches role lookups for 60 s
        const reader = await createAdmin(container, "reader@example.invalid")
        const everything = await createAdmin(container, "everything@example.invalid")
        await role(reader.userId, "orders-reader", (p) => p.resource === "order")
        await role(everything.userId, "reads-all", () => true)

        const { result: profiles } = await createShippingProfilesWorkflow(container).run({ input: { data: [{ name: "Default", type: "default" }] } })
        const { result: products } = await createProductsWorkflow(container).run({
          input: {
            products: [
              {
                title: "Demo",
                status: "published",
                shipping_profile_id: profiles[0]!.id,
                options: [{ title: "Size", values: ["M"] }],
                variants: [{ title: "M", sku: "DEMO-M", manage_inventory: false, options: { Size: "M" }, prices: [{ currency_code: "eur", amount: 5 }] }],
              },
            ],
          } as any,
        })
        const region = await createRegion(container, "eur", "at")
        const { result: order } = await createOrderWorkflow(container).run({
          input: {
            region_id: region.id,
            currency_code: "eur",
            email: "buyer@example.invalid",
            items: [{ variant_id: (products[0] as any).variants[0].id, quantity: 1, unit_price: 5 }],
            shipping_methods: [{ name: "Standard", amount: 1 }],
            shipping_address: { first_name: "Demo", last_name: "Buyer", address_1: "Teststrasse 1", city: "Wien", country_code: "at", postal_code: "1010" },
          } as any,
        })

        const restricted = await api.get(`/admin/orders/${order.id}?fields=${ORDER_FIELDS}`, { headers: reader.headers })
        expect(restricted.status).toBe(200)
        expect(restricted.data.order.items[0].title).toBe("Demo")
        expect(restricted.data.order.items[0].variant).toBeUndefined()

        const full = await api.get(`/admin/orders/${order.id}?fields=${ORDER_FIELDS}`, { headers: everything.headers })
        expect(full.status).toBe(200)
        expect(full.data.order.items[0].variant).toMatchObject({ inventory_items: [] })
      })
    })
  },
})
