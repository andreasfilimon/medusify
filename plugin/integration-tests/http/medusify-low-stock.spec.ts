import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createReservationsWorkflow, updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import { LOW_STOCK_QUIET_MS, claimAlert, isLow } from "../../src/lib/low-stock"
import lowStockLevelPushHandler from "../../src/subscribers/low-stock-level-push"
import lowStockReservationPushHandler from "../../src/subscribers/low-stock-reservation-push"
import { createAdmin, sub } from "../helpers/admin"
import { createCatalogProduct, createLocation } from "../helpers/catalog"

jest.setTimeout(180000)

const sendNotification = jest.fn()
jest.mock("web-push", () => ({
  sendNotification: (...args: unknown[]) => sendNotification(...args),
  generateVAPIDKeys: jest.fn(),
}))

async function waitFor(check: () => boolean | Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error("waitFor timed out")
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("low-stock push", () => {
      const service = () => getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
      const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
      let locA: string
      let locB: string
      let admin: Awaited<ReturnType<typeof createAdmin>>

      const seed = (n: number, extra: Record<string, unknown> = {}) =>
        service().createPushSubscriptions({ endpoint: sub(n).endpoint, p256dh: sub(n).keys.p256dh, auth: sub(n).keys.auth, user_id: admin.userId, ...extra })
      const sentTo = () => sendNotification.mock.calls.map((c) => c[0].endpoint as string)
      const bodies = () => sendNotification.mock.calls.map((c) => JSON.parse(c[1] as string))

      /** Reserves without an event (the inventory module's own call), so only the handler under test runs. */
      const reserve = (itemId: string, locationId: string, quantity: number) =>
        getContainer().resolve(Modules.INVENTORY).createReservationItems({ inventory_item_id: itemId, location_id: locationId, quantity }) as Promise<{ id: string }>
      const reservationEvent = (id: string) => ({ event: { name: "reservation-item.created", data: { id } }, container: getContainer(), pluginOptions: {} }) as any
      const levelEvent = (id: string, source?: string) => ({ event: { name: "inventory-level.updated", data: { id, ...(source ? { source } : {}) } }, container: getContainer(), pluginOptions: {} }) as any
      const levelOf = async (itemId: string, locationId: string) => {
        const { data } = await query().graph({ entity: "inventory_level", fields: ["id"], filters: { inventory_item_id: itemId, location_id: locationId } })
        return (data[0] as { id: string }).id
      }

      beforeEach(async () => {
        jest.restoreAllMocks()
        sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
        admin = await createAdmin(getContainer())
        locA = await createLocation(getContainer(), "Lager Wien")
        locB = await createLocation(getContainer(), "Lager Graz")
      })

      it("an order that takes stock down to the threshold tells the devices at or above it, with name, number and a link to the product", async () => {
        const p = await createCatalogProduct(getContainer(), { title: "Demo Tasse", levels: [{ location_id: locA, quantity: 10 }] })
        await seed(1) // default threshold 5
        await seed(2, { low_stock_threshold: 2 })
        await seed(3, { disabled_kinds: ["low_stock"] })
        const r = await reserve(p.inventoryItemId!, locA, 6) // 4 left
        await lowStockReservationPushHandler(reservationEvent(r.id))
        expect(sentTo()).toEqual([sub(1).endpoint])
        expect(bodies()[0]).toEqual({
          title: "Testshop: Bestand niedrig",
          body: "Demo Tasse · noch 4",
          data: { url: `/medusify/products/${p.productId}`, kind: "low_stock", shop: "Testshop" },
          tag: `low-stock-${p.inventoryItemId}`,
        })
      })

      it("sold out reads as sold out, and threshold 0 means exactly that", async () => {
        const p = await createCatalogProduct(getContainer(), { title: "Demo Tasse", levels: [{ location_id: locA, quantity: 3 }] })
        await seed(1, { low_stock_threshold: 0 })
        const r1 = await reserve(p.inventoryItemId!, locA, 2) // 1 left: above 0
        await lowStockReservationPushHandler(reservationEvent(r1.id))
        expect(sendNotification).not.toHaveBeenCalled()
        const r2 = await reserve(p.inventoryItemId!, locA, 1) // 0 left
        await lowStockReservationPushHandler(reservationEvent(r2.id))
        expect(sentTo()).toEqual([sub(1).endpoint])
        expect(bodies()[0]).toMatchObject({ title: "Testshop: Ausverkauft", body: "Demo Tasse" })
      })

      it("counts what can be sold over all locations: 3 here and 4 there is 7, not low for threshold 5", async () => {
        const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 3 }, { location_id: locB, quantity: 4 }] })
        await seed(1)
        const r = await reserve(p.inventoryItemId!, locA, 1) // 6 left in total
        await lowStockReservationPushHandler(reservationEvent(r.id))
        expect(sendNotification).not.toHaveBeenCalled()
        const r2 = await reserve(p.inventoryItemId!, locB, 1) // 5 left in total
        await lowStockReservationPushHandler(reservationEvent(r2.id))
        expect(sendNotification).toHaveBeenCalledTimes(1)
      })

      it("at most one message per device and item in 24 hours; a device with a lower threshold gets its own first message", async () => {
        const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
        await seed(1)
        await seed(2, { low_stock_threshold: 2 })
        const at = async (units: number) => {
          const r = await reserve(p.inventoryItemId!, locA, units)
          await lowStockReservationPushHandler(reservationEvent(r.id))
        }
        await at(6) // 4 left: device 1
        expect(sentTo()).toEqual([sub(1).endpoint])
        await at(1) // 3 left: device 1 is quiet
        expect(sentTo()).toEqual([sub(1).endpoint])
        await at(1) // 2 left: device 2 for the first time, device 1 still quiet
        expect(sentTo()).toEqual([sub(1).endpoint, sub(2).endpoint])
        await at(1) // 1 left: both quiet
        expect(sentTo()).toHaveLength(2)
        // a day later the same item may be announced again
        const pg = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION) as any
        await pg.raw(`UPDATE medusify_stock_alert SET last_sent_at = ? WHERE deleted_at IS NULL`, [new Date(Date.now() - LOW_STOCK_QUIET_MS - 60_000)])
        await at(1) // 0 left
        expect(sentTo()).toHaveLength(4)
        expect(bodies()[3]).toMatchObject({ title: "Testshop: Ausverkauft" })
      })

      it("claimAlert: five claims at the same moment, exactly one wins (and a claim after 24 hours wins again)", async () => {
        const wins = await Promise.all(Array.from({ length: 5 }, () => claimAlert(getContainer(), "msub_demo", "iitem_demo")))
        expect(wins.filter(Boolean)).toHaveLength(1)
        expect(await claimAlert(getContainer(), "msub_demo", "iitem_demo")).toBe(false)
        expect(await claimAlert(getContainer(), "msub_other", "iitem_demo")).toBe(true)
        expect(await claimAlert(getContainer(), "msub_demo", "iitem_demo", new Date(Date.now() + LOW_STOCK_QUIET_MS + 1000))).toBe(true)
      })

      it("two events at the same moment give one message per device", async () => {
        const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
        await seed(1)
        await seed(2)
        const r = await reserve(p.inventoryItemId!, locA, 8)
        await Promise.all([lowStockReservationPushHandler(reservationEvent(r.id)), lowStockReservationPushHandler(reservationEvent(r.id)), lowStockLevelPushHandler(levelEvent(await levelOf(p.inventoryItemId!, locA)))])
        expect(sentTo().sort()).toEqual([sub(1).endpoint, sub(2).endpoint])
      })

      it("a change the app made itself (source medusify) is skipped", async () => {
        const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 2 }] })
        await seed(1)
        await lowStockLevelPushHandler(levelEvent(await levelOf(p.inventoryItemId!, locA), "medusify"))
        expect(sendNotification).not.toHaveBeenCalled()
        // the same level without the mark is announced
        await lowStockLevelPushHandler(levelEvent(await levelOf(p.inventoryItemId!, locA)))
        expect(sendNotification).toHaveBeenCalledTimes(1)
      })

      it("stock above the threshold sends nothing, and a failing push service does not throw out of the handler", async () => {
        const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 50 }] })
        await seed(1)
        await lowStockLevelPushHandler(levelEvent(await levelOf(p.inventoryItemId!, locA)))
        expect(sendNotification).not.toHaveBeenCalled()
        sendNotification.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }))
        const low = await createCatalogProduct(getContainer(), { title: "Knapp", levels: [{ location_id: locA, quantity: 1 }] })
        await expect(lowStockLevelPushHandler(levelEvent(await levelOf(low.inventoryItemId!, locA)))).resolves.toBeUndefined()
      })

      it("a message that failed does not use up the 24 hours: the next change tries again", async () => {
        const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
        await seed(1)
        sendNotification.mockRejectedValueOnce(Object.assign(new Error("boom"), { statusCode: 500 }))
        const r1 = await reserve(p.inventoryItemId!, locA, 6)
        await lowStockReservationPushHandler(reservationEvent(r1.id))
        expect(sendNotification).toHaveBeenCalledTimes(1) // tried, failed
        const r2 = await reserve(p.inventoryItemId!, locA, 1)
        await lowStockReservationPushHandler(reservationEvent(r2.id))
        expect(sendNotification).toHaveBeenCalledTimes(2) // tried again, went out
        const r3 = await reserve(p.inventoryItemId!, locA, 1)
        await lowStockReservationPushHandler(reservationEvent(r3.id))
        expect(sendNotification).toHaveBeenCalledTimes(2) // now the 24 hours hold
      })

      it("an unknown event id sends nothing", async () => {
        await seed(1)
        await lowStockReservationPushHandler(reservationEvent("resitem_nope"))
        await lowStockLevelPushHandler(levelEvent("ilev_nope"))
        expect(sendNotification).not.toHaveBeenCalled()
      })

      it("is wired up: a reservation through Medusa's workflow and a stock edit in Medusa each reach the sender", async () => {
        const p = await createCatalogProduct(getContainer(), { title: "Demo Tasse", levels: [{ location_id: locA, quantity: 10 }] })
        await seed(1)
        await createReservationsWorkflow(getContainer()).run({ input: { reservations: [{ inventory_item_id: p.inventoryItemId!, location_id: locA, quantity: 7 }] } })
        await waitFor(() => sendNotification.mock.calls.length >= 1)
        expect(bodies()[0]).toMatchObject({ title: "Testshop: Bestand niedrig", body: "Demo Tasse · noch 3" })
        // another item, changed in the admin: inventory-level.updated
        const q = await createCatalogProduct(getContainer(), { title: "Zweite Tasse", levels: [{ location_id: locA, quantity: 10 }] })
        sendNotification.mockClear()
        await updateInventoryLevelsWorkflow(getContainer()).run({ input: { updates: [{ inventory_item_id: q.inventoryItemId!, location_id: locA, stocked_quantity: 2 }] } })
        await waitFor(() => sendNotification.mock.calls.length >= 1)
        expect(bodies()[0]).toMatchObject({ body: "Zweite Tasse · noch 2" })
      })

      it("a count made in the app does not produce a push, even through the real event bus", async () => {
        const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
        await seed(1)
        const res = await api.post("/admin/medusify/inventory", { mode: "set", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1, idempotency_key: "count-from-app-1" }, { headers: admin.headers })
        expect(res.data.stocked).toBe(1)
        await sleep(2000) // long enough for the subscriber to have run
        expect(sendNotification).not.toHaveBeenCalled()
      })

      it("isLow: at or below", () => {
        expect(isLow(5, 5)).toBe(true)
        expect(isLow(6, 5)).toBe(false)
        expect(isLow(0, 0)).toBe(true)
        expect(isLow(-1, 0)).toBe(true)
      })
    })
  },
})
