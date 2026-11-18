import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import { needsShipping } from "../../src/lib/dashboard"
import { createAdmin, sub } from "../helpers/admin"
import { createDemoOrder, createRegion, listedStatuses, refundDemoOrder } from "../helpers/orders"

jest.setTimeout(120 * 1000)

const sendNotification = jest.fn()
jest.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: jest.fn(),
}))

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("medusify admin API", () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>
      beforeEach(async () => {
        sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
        admin = await createAdmin(getContainer())
      })

      describe("authentication", () => {
        // every row has 3 entries: with 2, jest would hand the 3rd test argument over as a `done` callback
        const routes: [string, string, unknown][] = [
          ["get", "/admin/medusify/vapid-public-key", null],
          ["post", "/admin/medusify/push-subscriptions", sub(1)],
          ["delete", "/admin/medusify/push-subscriptions?endpoint=https://push.example.invalid/x", null],
          ["post", "/admin/medusify/push-subscriptions/test", {}],
          ["get", "/admin/medusify/dashboard", null],
        ]
        it.each(routes)("%s %s without login → 401", async (method, url, body) => {
          const call = (api as any)[method](url, ...(method === "post" ? [body, {}] : [{}]))
          await expect(call).rejects.toMatchObject({ response: { status: 401 } })
        })

        it("rejects a bad bearer token with 401", async () => {
          await expect(
            api.get("/admin/medusify/dashboard", { headers: { authorization: "Bearer not-a-token" } })
          ).rejects.toMatchObject({ response: { status: 401 } })
        })
      })

      describe("vapid public key", () => {
        it("returns only the public key", async () => {
          const res = await api.get("/admin/medusify/vapid-public-key", { headers: admin.headers })
          expect(res.status).toBe(200)
          expect(res.data).toEqual({ public_key: process.env.MEDUSIFY_VAPID_PUBLIC_KEY })
          expect(JSON.stringify(res.data)).not.toContain(process.env.MEDUSIFY_VAPID_PRIVATE_KEY as string)
        })
      })

      describe("push subscriptions", () => {
        it("creates (201), is idempotent per endpoint (200) and keeps one row", async () => {
          const first = await api.post("/admin/medusify/push-subscriptions", sub(1), { headers: admin.headers })
          expect(first.status).toBe(201)
          expect(first.data.created).toBe(true)
          const again = await api.post(
            "/admin/medusify/push-subscriptions",
            sub(1, { user_agent: "iPhone" }),
            { headers: admin.headers }
          )
          expect(again.status).toBe(200)
          expect(again.data.created).toBe(false)
          expect(again.data.subscription.id).toBe(first.data.subscription.id)

          const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
          const rows = await service.listPushSubscriptions({}, { take: null })
          expect(rows).toHaveLength(1)
          expect(rows[0]).toMatchObject({ user_id: admin.userId, user_agent: "iPhone", failure_count: 0 })
        })

        it("validates the body (400)", async () => {
          for (const bad of [
            { endpoint: "http://insecure.example.invalid/x", keys: sub(1).keys },
            { endpoint: "https://push.example.invalid/x", keys: { p256dh: "", auth: "a" } },
            { endpoint: "https://push.example.invalid/x" },
            {},
          ]) {
            await expect(
              api.post("/admin/medusify/push-subscriptions", bad, { headers: admin.headers })
            ).rejects.toMatchObject({ response: { status: 400 } })
          }
        })

        it("deletes by endpoint via body and via query, idempotently", async () => {
          await api.post("/admin/medusify/push-subscriptions", sub(1), { headers: admin.headers })
          await api.post("/admin/medusify/push-subscriptions", sub(2), { headers: admin.headers })

          const byBody = await api.delete("/admin/medusify/push-subscriptions", {
            headers: admin.headers,
            data: { endpoint: sub(1).endpoint },
          })
          expect(byBody.data).toEqual({ deleted: 1 })
          const byQuery = await api.delete(
            `/admin/medusify/push-subscriptions?endpoint=${encodeURIComponent(sub(2).endpoint)}`,
            { headers: admin.headers }
          )
          expect(byQuery.data).toEqual({ deleted: 1 })
          const again = await api.delete("/admin/medusify/push-subscriptions", {
            headers: admin.headers,
            data: { endpoint: sub(2).endpoint },
          })
          expect(again.data).toEqual({ deleted: 0 })
        })

        it("an admin cannot delete another admin's subscription", async () => {
          const other = await createAdmin(getContainer(), "other@example.invalid")
          await api.post("/admin/medusify/push-subscriptions", sub(1), { headers: other.headers })
          const res = await api.delete("/admin/medusify/push-subscriptions", {
            headers: admin.headers,
            data: { endpoint: sub(1).endpoint },
          })
          expect(res.data).toEqual({ deleted: 0 })
          const service = getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
          expect(await service.listPushSubscriptions({}, { take: null })).toHaveLength(1)
        })

        it("test push goes only to the caller's own subscriptions", async () => {
          const other = await createAdmin(getContainer(), "other@example.invalid")
          await api.post("/admin/medusify/push-subscriptions", sub(1), { headers: admin.headers })
          await api.post("/admin/medusify/push-subscriptions", sub(2), { headers: other.headers })

          const res = await api.post("/admin/medusify/push-subscriptions/test", {}, { headers: admin.headers })
          expect(res.data).toEqual({ sent: 1, failed: 0, removed: 0 })
          expect(sendNotification).toHaveBeenCalledTimes(1)
          expect(sendNotification.mock.calls[0][0].endpoint).toBe(sub(1).endpoint)
          expect(JSON.parse(sendNotification.mock.calls[0][1]).title).toContain("Testshop")
        })

        it("answers 404 for any other action under push-subscriptions and sends nothing", async () => {
          await api.post("/admin/medusify/push-subscriptions", sub(1), { headers: admin.headers })
          const res = await api
            .post("/admin/medusify/push-subscriptions/other", {}, { headers: admin.headers })
            .catch((e: any) => e.response)
          expect(res.status).toBe(404)
          expect(sendNotification).not.toHaveBeenCalled()
        })
      })

      describe("dashboard", () => {
        it("sums per currency and matches the test orders; counts to-ship correctly", async () => {
          const container = getContainer()
          const eur = await createRegion(container, "eur", "at")
          const usd = await createRegion(container, "usd", "us")

          // paid EUR: 2 × 19.99 + 5.00 shipping = 44.98
          const paidEur = await createDemoOrder(container, { regionId: eur.id, paid: true })
          // unpaid EUR: 1 × 10.00 + 2.50 = 12.50 (a draft that was never paid: not revenue)
          await createDemoOrder(container, {
            regionId: eur.id,
            items: [{ title: "Gadget", quantity: 1, unit_price: 10 }],
            shipping: 2.5,
          })
          // USD: 3 × 7.10 + 1.00 = 22.30
          await createDemoOrder(container, {
            regionId: usd.id,
            paid: true,
            currency: "usd",
            country: "us",
            items: [{ title: "Thing", quantity: 3, unit_price: 7.1 }],
            shipping: 1,
          })
          // canceled orders never count
          await createDemoOrder(container, {
            regionId: eur.id,
            status: "canceled",
            items: [{ title: "Gone", quantity: 1, unit_price: 999 }],
          })

          const res = await api.get("/admin/medusify/dashboard?tz=Europe/Vienna", { headers: admin.headers })
          expect(res.status).toBe(200)
          const d = res.data
          expect(d.timezone).toBe("Europe/Vienna")
          expect(d.today.orders).toBe(2) // the unpaid order is not counted
          expect(d.today.revenue).toEqual([
            { currency_code: "eur", amount: 44.98 }, // only the paid order, exact, no float drift
            { currency_code: "usd", amount: 22.3 },
          ])
          expect(d.month.orders).toBe(2)
          expect(d.month.revenue).toEqual(d.today.revenue)
          expect(d.to_ship).toBe(2) // the two paid, unshipped orders (EUR and USD); the unpaid one is not

          expect(d.recent_orders).toHaveLength(4) // unpaid and canceled orders are listed (with status), newest first
          const paid = d.recent_orders.find((o: any) => o.id === paidEur.id)
          expect(paid).toMatchObject({
            display_id: 1,
            currency_code: "eur",
            total: 44.98,
            status: "pending",
            payment_status: "captured",
            fulfillment_status: "not_fulfilled",
            country_code: "at",
            item_count: 2,
          })
          expect(d.recent_orders.map((o: any) => o.display_id)).toEqual([4, 3, 2, 1])
        })

        it("revenue counts authorized and captured payments, nets out refunds, and ignores unpaid orders", async () => {
          const container = getContainer()
          const eur = await createRegion(container, "eur", "at")
          const one = [{ title: "Item", quantity: 1, unit_price: 10 }]
          // 10 + 5 shipping = 15.00 each
          const captured = await createDemoOrder(container, { regionId: eur.id, items: one, paid: true })
          const authorized = await createDemoOrder(container, { regionId: eur.id, items: one, authorized: true })
          await createDemoOrder(container, { regionId: eur.id, items: one }) // never paid
          const partlyRefunded = await createDemoOrder(container, { regionId: eur.id, items: one, paid: true })
          const refunded = await createDemoOrder(container, { regionId: eur.id, items: one, paid: true })
          await refundDemoOrder(container, partlyRefunded.id, 4) // 15 - 4 = 11
          await refundDemoOrder(container, refunded.id, 15) // 15 - 15 = 0, not a sale any more

          expect((await listedStatuses(container, captured.id)).payment_status).toBe("captured")
          expect((await listedStatuses(container, authorized.id)).payment_status).toBe("authorized")
          expect((await listedStatuses(container, partlyRefunded.id)).payment_status).toBe("partially_refunded")
          expect((await listedStatuses(container, refunded.id)).payment_status).toBe("refunded")

          const { data: d } = await api.get("/admin/medusify/dashboard", { headers: admin.headers })
          // captured 15 + authorized 15 + partly refunded 11 = 41; fully refunded order and unpaid order do not count
          expect(d.today.revenue).toEqual([{ currency_code: "eur", amount: 41 }])
          expect(d.today.orders).toBe(3)
          expect(d.month.orders).toBe(3)
          // to ship: captured, authorized is not captured yet (no), partly refunded still ships, fully refunded does not
          expect(d.to_ship).toBe(2)
        })

        it("rejects an unknown time zone with 400 and defaults to UTC", async () => {
          await expect(
            api.get("/admin/medusify/dashboard?tz=Mars/Base", { headers: admin.headers })
          ).rejects.toMatchObject({ response: { status: 400 } })
          const res = await api.get("/admin/medusify/dashboard", { headers: admin.headers })
          expect(res.data.timezone).toBe("UTC")
          expect(res.data).toMatchObject({ to_ship: 0, recent_orders: [], today: { orders: 0, revenue: [] } })
        })
      })

      describe("needsShipping", () => {
        it.each([
          ["captured", "not_fulfilled", true],
          ["captured", "fulfilled", true],
          ["captured", "partially_shipped", true],
          ["captured", "shipped", false],
          ["captured", "delivered", false],
          ["captured", "canceled", true], // a canceled fulfillment gives its quantity back: the goods still have to go out
          ["refunded", "partially_shipped", false], // fully refunded: nothing more is shipped, even if a part is on its way
          ["not_paid", "not_fulfilled", false],
          ["awaiting", "not_fulfilled", false],
          ["refunded", "not_fulfilled", false],
          ["partially_refunded", "not_fulfilled", true], // Medusa reports any refund as partially_refunded, the goods still ship
          ["partially_refunded", "shipped", false],
        ])("%s + %s → %s", (pay, ful, expected) => {
          expect(needsShipping(pay as string, ful as string)).toBe(expected)
        })
      })
    })
  },
})
