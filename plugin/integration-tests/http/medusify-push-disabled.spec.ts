import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import orderPlacedPushHandler from "../../src/subscribers/order-placed-push"
import { createAdmin, sub } from "../helpers/admin"
import { createDemoOrder, createRegion } from "../helpers/orders"

jest.setTimeout(120 * 1000)

// Misconfiguration (invalid private key) must not stop the shop: push is off, everything else works.
process.env.MEDUSIFY_VAPID_PRIVATE_KEY = "not-a-key"

const sendNotification = jest.fn()
jest.mock("web-push", () => ({ sendNotification: (...a: unknown[]) => sendNotification(...a) }))

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("push misconfigured", () => {
      it("boots, reports push as off, keeps the dashboard working and sends nothing", async () => {
        const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
        expect(service.isEnabled()).toBe(false)
        expect(service.getConfig().problems.join(" ")).toContain("vapid.privateKey")

        const admin = await createAdmin(getContainer())
        await expect(
          api.get("/admin/medusify/vapid-public-key", { headers: admin.headers })
        ).rejects.toMatchObject({ response: { status: 400, data: { message: expect.stringContaining("not configured") } } })
        await expect(
          api.post("/admin/medusify/push-subscriptions/test", {}, { headers: admin.headers })
        ).rejects.toMatchObject({ response: { status: 400 } })

        const dash = await api.get("/admin/medusify/dashboard", { headers: admin.headers })
        expect(dash.status).toBe(200)

        // subscriptions can still be stored (device registered before the config is fixed)
        const created = await api.post("/admin/medusify/push-subscriptions", sub(1), { headers: admin.headers })
        expect(created.status).toBe(201)

        const region = await createRegion(getContainer())
        const order = await createDemoOrder(getContainer(), { regionId: region.id })
        await orderPlacedPushHandler({ event: { data: { id: order.id } }, container: getContainer() } as any)
        expect(sendNotification).not.toHaveBeenCalled()
      })
    })
  },
})
