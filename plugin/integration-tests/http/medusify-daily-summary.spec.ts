import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import { dueDay, sendDailySummaries } from "../../src/lib/daily-summary"
import { createAdmin, sub } from "../helpers/admin"
import { createDemoOrder, createRegion } from "../helpers/orders"

jest.setTimeout(180000)

const sendNotification = jest.fn()
jest.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: jest.fn(),
}))

/** Demo orders and example.invalid users only. */
medusaIntegrationTestRunner({
  testSuite: ({ getContainer }) => {
    describe("daily summary push (Stufe 4)", () => {
      const service = () => getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
      let admin: Awaited<ReturnType<typeof createAdmin>>
      const seed = (n: number, extra: Record<string, unknown> = {}) =>
        service().createPushSubscriptions({ endpoint: sub(n).endpoint, p256dh: sub(n).keys.p256dh, auth: sub(n).keys.auth, user_id: admin.userId, ...extra })
      const sentTo = () => sendNotification.mock.calls.map((c) => c[0].endpoint as string)
      const bodies = () => sendNotification.mock.calls.map((c) => JSON.parse(c[1] as string))
      /** 20:05 in Vienna on a winter day (UTC+1). */
      const evening = new Date("2026-01-15T19:05:00Z")

      beforeEach(async () => {
        sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
        admin = await createAdmin(getContainer())
      })

      it("is due once in its hour on the device's clock, and never twice a day", () => {
        const s = { id: "x", endpoint: "", p256dh: "", auth: "", user_id: "u", daily_summary_hour: 20, daily_summary_tz: "Europe/Vienna" }
        expect(dueDay(s, evening)).toBe("2026-01-15")
        expect(dueDay({ ...s, daily_summary_sent_on: "2026-01-15" }, evening)).toBeNull()
        expect(dueDay(s, new Date("2026-01-15T18:59:00Z"))).toBeNull() // 19:59 in Vienna
        expect(dueDay({ ...s, daily_summary_tz: "UTC" }, evening)).toBeNull() // 19:05 there
        expect(dueDay({ ...s, daily_summary_hour: null }, evening)).toBeNull()
        expect(dueDay({ ...s, daily_summary_tz: "Mars/Base" }, evening)).toBeNull()
      })

      it("sends the day's numbers to the devices whose hour has come, once, per currency", async () => {
        const eur = (await createRegion(getContainer(), "eur", "at")).id
        await createDemoOrder(getContainer(), { regionId: eur, paid: true }) // 44.98, to ship
        await createDemoOrder(getContainer(), { regionId: eur }) // unpaid: no revenue
        await seed(1, { daily_summary_hour: 20, daily_summary_tz: "Europe/Vienna" })
        await seed(2, { daily_summary_hour: 7, daily_summary_tz: "Europe/Vienna" }) // not its hour
        await seed(3) // off
        // the orders were placed now, so the summary is asked for "now" at 20:xx in a zone where it is that hour
        const now = new Date()
        const off = ((20 - now.getUTCHours() + 36) % 24) - 12 // UTC offset in hours, −12…+11, at which it is 20:xx now
        const zone = off >= 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}` // the Etc names have the sign the other way round
        await service().updatePushSubscriptions({ id: (await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0].id, daily_summary_tz: zone })

        expect(await sendDailySummaries(getContainer(), now)).toEqual({ sent: 1, skipped: 0 })
        expect(sentTo()).toEqual([sub(1).endpoint])
        const [p] = bodies()
        expect(p.title).toMatch(/: Heute$/)
        expect(p.body).toBe("1 Bestellung · 44,98 € · 1 zu versenden")
        expect(p.data).toMatchObject({ kind: "daily_summary", badge: 1 })

        // a second run in the same hour (or a second backend process) sends nothing
        expect(await sendDailySummaries(getContainer(), new Date(now.getTime() + 60_000))).toEqual({ sent: 0, skipped: 0 })
        expect(sendNotification).toHaveBeenCalledTimes(1)
      })

      it("two backend processes in the same minute send it once (the day is claimed in one statement)", async () => {
        for (const n of [1, 2, 3]) await seed(n, { daily_summary_hour: 20, daily_summary_tz: "Europe/Vienna" })
        // both runs read the subscriptions before either has claimed a day
        const [a, b] = await Promise.all([sendDailySummaries(getContainer(), evening), sendDailySummaries(getContainer(), evening)])
        expect(a.sent + b.sent).toBe(3)
        expect([...sentTo()].sort()).toEqual([sub(1).endpoint, sub(2).endpoint, sub(3).endpoint].sort())
        // each subscription (device and shop) has its own tag: two shops on one phone do not replace each other's summary
        expect(new Set(sendNotification.mock.calls.map((c) => JSON.parse(c[1] as string).tag)).size).toBe(3)
      })

      it("an error after the message went out keeps the day, so it is not sent twice", async () => {
        await seed(1, { daily_summary_hour: 20, daily_summary_tz: "Europe/Vienna" })
        const send = jest.spyOn(service(), "sendToSubscriptions").mockImplementationOnce(async () => {
          await sendNotification({ endpoint: sub(1).endpoint }, "{}")
          throw new Error("bookkeeping failed")
        })
        try {
          expect(await sendDailySummaries(getContainer(), evening)).toEqual({ sent: 0, skipped: 0 })
          expect((await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0].daily_summary_sent_on).toBe("2026-01-15")
          expect(await sendDailySummaries(getContainer(), new Date(evening.getTime() + 15 * 60_000))).toEqual({ sent: 0, skipped: 0 })
          expect(sendNotification).toHaveBeenCalledTimes(1)
        } finally {
          send.mockRestore()
        }
      })

      it("a message that did not go out gives the day back, the next run sends it", async () => {
        await seed(1, { daily_summary_hour: 20, daily_summary_tz: "Europe/Vienna" })
        sendNotification.mockRejectedValueOnce(Object.assign(new Error("push service down"), { statusCode: 503 }))
        expect(await sendDailySummaries(getContainer(), evening)).toEqual({ sent: 0, skipped: 0 })
        expect((await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0].daily_summary_sent_on).toBeNull()
        expect(await sendDailySummaries(getContainer(), new Date(evening.getTime() + 15 * 60_000))).toEqual({ sent: 1, skipped: 0 })
        expect((await service().listPushSubscriptions({ endpoint: sub(1).endpoint }))[0].daily_summary_sent_on).toBe("2026-01-15")
        expect(bodies()[1].body).toBe("0 Bestellungen")
      })
    })
  },
})
