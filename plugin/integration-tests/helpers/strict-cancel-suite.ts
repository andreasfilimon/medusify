import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdmin } from "./admin"
import { createDemoOrder, createRegion } from "./orders"

/**
 * Medusa's own `POST /admin/orders/:id/cancel` asks only for `order:update` and refunds every captured payment. With the
 * plugin option `strictCancelRefund` it asks for the refund right as well when captured money would go back; without it
 * Medusa's behaviour is unchanged. One suite, run once with the option on and once without.
 */
export function strictCancelSuite(enforced: boolean) {
  return ({ api, getContainer }: { api: any; getContainer: () => MedusaContainer }) => {
    const rbac = () => getContainer().resolve(Modules.RBAC) as any

    async function giveRole(userId: string, name: string, keys: string[]) {
      const role = await rbac().createRbacRoles({ name })
      for (const key of keys) {
        const [resource, operation] = key.split(":")
        const [policy] = await rbac().listRbacPolicies({ resource, operation })
        if (!policy) throw new Error(`policy ${key} does not exist`)
        await rbac().createRbacRolePolicies({ role_id: role.id, policy_id: policy.id })
      }
      await rbac().createRbacRoleAssignments({ role_id: role.id, reference: "user", reference_id: userId })
    }

    describe(`Medusa's own cancel route, strictCancelRefund ${enforced ? "on" : "off (default)"}`, () => {
      it("the option is what the shop was started with (otherwise the test proves nothing)", () => {
        const service = getContainer().resolve("medusifyPush") as any
        expect(service.getConfig().strictCancelRefund).toBe(enforced)
      })

      it(enforced ? "a role without the refund right cannot cancel an order that holds captured money" : "a role without the refund right can cancel it, as in plain Medusa", async () => {
        const canceler = await createAdmin(getContainer(), "canceler@example.invalid")
        // Medusa's route also reads the order back for its answer, so a desktop role has the read right too
        await giveRole(canceler.userId, "cancel-only", ["order:read", "order:update"])
        const refunder = await createAdmin(getContainer(), "refunder@example.invalid")
        await giveRole(refunder.userId, "cancel-and-refund", ["order:read", "order:update", "refund:create"])
        const region = await createRegion(getContainer(), "eur", "at")
        const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
        const statusOf = async (id: string) =>
          (await query.graph({ entity: "order", fields: ["id", "status"], filters: { id } })).data[0].status as string
        const core = (id: string, who: { headers: Record<string, string> }) => api.post(`/admin/orders/${id}/cancel`, {}, { headers: who.headers })

        const paid = await createDemoOrder(getContainer(), { regionId: region.id, paid: true })
        if (enforced) {
          await expect(core(paid.id, canceler)).rejects.toMatchObject({ response: { status: 403 } })
          expect(await statusOf(paid.id)).toBe("pending")
          expect((await core(paid.id, refunder)).status).toBe(200)
        } else {
          expect((await core(paid.id, canceler)).status).toBe(200)
        }
        expect(await statusOf(paid.id)).toBe("canceled")

        // nothing captured: nothing to refund, the order right is enough
        const unpaid = await createDemoOrder(getContainer(), { regionId: region.id })
        expect((await core(unpaid.id, canceler)).status).toBe(200)

        // an order that does not exist is Medusa's 404, not ours
        await expect(core("order_does_not_exist", canceler)).rejects.toMatchObject({ response: { status: 404 } })
      })
    })
  }
}
