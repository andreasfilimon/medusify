import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdmin } from "../helpers/admin"
import { createDemoOrder, createRegion } from "../helpers/orders"

jest.setTimeout(120 * 1000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("POST /admin/medusify/orders/:id/cancel under load", () => {
      it("two cancels of one paid order at the same time: one cancels and refunds, the other is refused, the money goes back once", async () => {
        const admin = await createAdmin(getContainer())
        const region = await createRegion(getContainer(), "eur", "at")
        const order = await createDemoOrder(getContainer(), { regionId: region.id, paid: true })
        const cancel = () => api.post(`/admin/medusify/orders/${order.id}/cancel`, {}, { headers: admin.headers }).then(
          (r) => r.status,
          (e) => e.response?.status as number,
        )
        const statuses = await Promise.all([cancel(), cancel(), cancel()])
        expect(statuses.filter((s) => s === 200)).toHaveLength(1)
        expect(statuses.filter((s) => s !== 200).every((s) => s >= 400 && s < 500)).toBe(true)

        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const {
          data: [row],
        } = await query.graph({
          entity: "order",
          fields: ["id", "status", "payment_collections.payments.refunds.raw_amount"],
          filters: { id: order.id },
        })
        expect(row.status).toBe("canceled")
        const refunds = (row.payment_collections ?? []).flatMap((c: any) => (c.payments ?? []).flatMap((p: any) => p.refunds ?? []))
        expect(refunds).toHaveLength(1)
      })
    })
  },
})
