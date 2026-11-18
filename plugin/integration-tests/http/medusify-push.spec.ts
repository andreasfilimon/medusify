import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE, MAX_CONSECUTIVE_FAILURES } from "../../src/constants"
import orderPlacedPushHandler from "../../src/subscribers/order-placed-push"
import { sub } from "../helpers/admin"
import { createDemoOrder, createRegion } from "../helpers/orders"

jest.setTimeout(120 * 1000)

const sendNotification = jest.fn()
jest.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: jest.fn(),
}))

const pushError = (statusCode: number) => Object.assign(new Error(`push service said ${statusCode}`), { statusCode })

async function waitFor(check: () => boolean | Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("waitFor timed out")
}

medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("order.placed push", () => {
      const service = () => getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
      const rows = () => service().listPushSubscriptions({}, { take: null }) as Promise<any[]>
      const seed = (n: number, extra: Record<string, unknown> = {}) =>
        service().createPushSubscriptions({
          endpoint: sub(n).endpoint,
          p256dh: sub(n).keys.p256dh,
          auth: sub(n).keys.auth,
          user_id: "user_demo",
          ...extra,
        })
      let orderId: string

      beforeEach(async () => {
        jest.restoreAllMocks()
        sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
        const region = await createRegion(getContainer(), "eur", "at")
        // 2 × 19.99 + 5.00 = 44.98 EUR, 2 items
        orderId = (await createDemoOrder(getContainer(), { regionId: region.id, paid: true })).id
      })

      it("sends title, text and url to every subscription (handler called directly)", async () => {
        await seed(1)
        await seed(2)
        await orderPlacedPushHandler({ event: { data: { id: orderId }, name: "order.placed" }, container: getContainer(), pluginOptions: {} } as any)

        expect(sendNotification).toHaveBeenCalledTimes(2)
        const [subscription, body, options] = sendNotification.mock.calls[0]
        expect(subscription.endpoint).toMatch(/^https:\/\/push\.example\.invalid\/send\/[12]$/)
        expect(subscription.keys).toEqual(sub(1).keys)
        expect(JSON.parse(body)).toEqual({
          title: "Testshop: Neue Bestellung #1",
          body: "44,98 € · 2 Artikel",
          data: { url: `/medusify/orders/${orderId}` },
          tag: `order-${orderId}`,
        })
        expect(options.vapidDetails).toEqual({
          subject: "mailto:test@example.invalid",
          publicKey: process.env.MEDUSIFY_VAPID_PUBLIC_KEY,
          privateKey: process.env.MEDUSIFY_VAPID_PRIVATE_KEY,
        })
        const marked = await rows()
        expect(marked).toHaveLength(2)
        for (const r of marked) {
          expect(r.last_success_at).not.toBeNull()
          expect(r.failure_count).toBe(0)
        }
      })

      it("is wired up: an order.placed event on the bus reaches the sender", async () => {
        await seed(1)
        await getContainer().resolve(Modules.EVENT_BUS).emit({ name: "order.placed", data: { id: orderId } })
        await waitFor(() => sendNotification.mock.calls.length === 1)
        expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toBe("Testshop: Neue Bestellung #1")
      })

      it("deletes the subscription when the push service answers 410 (and 404)", async () => {
        await seed(1)
        await seed(2)
        await seed(3)
        sendNotification.mockImplementation(async (s: { endpoint: string }) => {
          if (s.endpoint.endsWith("/1")) throw pushError(410)
          if (s.endpoint.endsWith("/2")) throw pushError(404)
          return { statusCode: 201 }
        })
        await orderPlacedPushHandler({ event: { data: { id: orderId } }, container: getContainer() } as any)

        const left = await rows()
        expect(left.map((r) => r.endpoint)).toEqual([sub(3).endpoint])
      })

      it("counts other failures, keeps the subscription, resets on success, drops after the limit", async () => {
        await seed(1)
        sendNotification.mockRejectedValue(pushError(500))
        await orderPlacedPushHandler({ event: { data: { id: orderId } }, container: getContainer() } as any)
        let [row] = await rows()
        expect(row.failure_count).toBe(1)
        expect(row.last_success_at).toBeNull()

        sendNotification.mockResolvedValue({ statusCode: 201 })
        await orderPlacedPushHandler({ event: { data: { id: orderId } }, container: getContainer() } as any)
        ;[row] = await rows()
        expect(row.failure_count).toBe(0)
        expect(row.last_success_at).not.toBeNull()

        await service().updatePushSubscriptions({ id: row.id, failure_count: MAX_CONSECUTIVE_FAILURES - 1 })
        sendNotification.mockRejectedValue(pushError(503))
        await orderPlacedPushHandler({ event: { data: { id: orderId } }, container: getContainer() } as any)
        expect(await rows()).toHaveLength(0)
      })

      describe("fail-open", () => {
        it("a throwing sender never throws out of the subscriber, the order is untouched", async () => {
          await seed(1)
          sendNotification.mockImplementation(() => {
            throw new Error("network down")
          })
          await expect(
            orderPlacedPushHandler({ event: { data: { id: orderId } }, container: getContainer() } as any)
          ).resolves.toBeUndefined()
          const query = getContainer().resolve(ContainerRegistrationKeys.QUERY)
          const { data } = await query.graph({ entity: "order", fields: ["id", "status"], filters: { id: orderId } })
          expect(data).toEqual([{ id: orderId, status: "pending" }])
        })

        it("a failure BEFORE the sender (service/DB error) is logged and swallowed", async () => {
          await seed(1)
          jest.spyOn(service(), "sendToAll").mockRejectedValue(new Error("db exploded"))
          const logger = getContainer().resolve(ContainerRegistrationKeys.LOGGER)
          const logError = jest.spyOn(logger, "error").mockImplementation(() => undefined)

          await expect(
            orderPlacedPushHandler({ event: { data: { id: orderId } }, container: getContainer() } as any)
          ).resolves.toBeUndefined()
          expect(logError).toHaveBeenCalledWith(expect.stringContaining("db exploded"))
        })

        it("emitting the event stays harmless and OUR handler logs the swallowed error", async () => {
          await seed(1)
          jest.spyOn(service(), "sendToAll").mockRejectedValue(new Error("boom"))
          const logger = getContainer().resolve(ContainerRegistrationKeys.LOGGER)
          const logError = jest.spyOn(logger, "error").mockImplementation(() => undefined)
          await expect(
            getContainer().resolve(Modules.EVENT_BUS).emit({ name: "order.placed", data: { id: orderId } })
          ).resolves.not.toThrow()
          // the event bus swallows subscriber errors itself — so only the handler's own log line proves fail-open
          await waitFor(() =>
            logError.mock.calls.some(([m]) => String(m).includes(`[medusify] push for order ${orderId} failed (ignored): boom`))
          )
        })

        it("an unknown order id does nothing", async () => {
          await seed(1)
          await orderPlacedPushHandler({ event: { data: { id: "order_missing" } }, container: getContainer() } as any)
          expect(sendNotification).not.toHaveBeenCalled()
        })
      })
    })
  },
})
