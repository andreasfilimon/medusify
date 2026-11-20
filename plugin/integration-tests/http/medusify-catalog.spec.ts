import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../../src/constants"
import { createAdmin } from "../helpers/admin"
import { createCatalogProduct, createLocation } from "../helpers/catalog"
import { createRegion } from "../helpers/orders"

jest.setTimeout(180000)


medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("catalog and stock (Stufe 2)", () => {
      let admin: Awaited<ReturnType<typeof createAdmin>>
      let locA: string
      let locB: string
      const h = () => ({ headers: admin.headers })
      const query = () => getContainer().resolve(ContainerRegistrationKeys.QUERY)
      const push = () => getContainer().resolve(MEDUSIFY_PUSH_MODULE) as any
      let n = 0
      const key = (label = "k") => `${label}-${++n}-${Math.random().toString(36).slice(2, 10)}`

      beforeEach(async () => {
        admin = await createAdmin(getContainer())
        locA = await createLocation(getContainer(), "Lager Wien")
        locB = await createLocation(getContainer(), "Lager Graz")
      })

      async function level(itemId: string, locationId: string) {
        const { data } = await query().graph({ entity: "inventory_level", fields: ["id", "stocked_quantity", "reserved_quantity"], filters: { inventory_item_id: itemId, location_id: locationId } })
        return data[0] as { id: string; stocked_quantity: number; reserved_quantity: number } | undefined
      }
      const stocked = async (itemId: string, locationId = locA) => Number((await level(itemId, locationId))?.stocked_quantity)
      const stock = (body: Record<string, unknown>) => api.post("/admin/medusify/inventory", body, h())

      describe("GET /admin/medusify/products", () => {
        it("lists title, status, price and the stock per location, summed over the locations", async () => {
          const p = await createCatalogProduct(getContainer(), {
            title: "Demo Tasse",
            sku: "TASSE-1",
            barcode: "4006381333931",
            levels: [
              { location_id: locA, quantity: 10 },
              { location_id: locB, quantity: 4 },
            ],
          })
          const res = await api.get("/admin/medusify/products", h())
          expect(res.status).toBe(200)
          expect(res.data.count).toBe(1)
          const [product] = res.data.products
          expect(product).toMatchObject({ id: p.productId, title: "Demo Tasse", status: "published", thumbnail: null })
          const [variant] = product.variants
          expect(variant).toMatchObject({ id: p.variantId, sku: "TASSE-1", barcode: "4006381333931", manage_inventory: true, stock_total: 14, stock_editable: true })
          expect(variant.prices).toEqual([{ id: expect.any(String), currency_code: "eur", amount: 12.5, base: true }])
          expect(variant.inventory[0].levels.map((l: any) => [l.location_name, l.stocked, l.available]).sort()).toEqual([
            ["Lager Graz", 4, 4],
            ["Lager Wien", 10, 10],
          ])
        })

        it("searches by title, filters by status, pages", async () => {
          await createCatalogProduct(getContainer(), { title: "Alpha Becher", levels: [{ location_id: locA, quantity: 1 }] })
          await createCatalogProduct(getContainer(), { title: "Beta Teller", status: "draft", levels: [{ location_id: locA, quantity: 1 }] })
          await createCatalogProduct(getContainer(), { title: "Gamma Kanne", levels: [{ location_id: locA, quantity: 1 }] })
          const titles = (r: any) => r.data.products.map((x: any) => x.title)
          expect(titles(await api.get("/admin/medusify/products?q=Becher", h()))).toEqual(["Alpha Becher"])
          expect(titles(await api.get("/admin/medusify/products?q=gibtesnicht", h()))).toEqual([])
          expect(titles(await api.get("/admin/medusify/products?status=draft", h()))).toEqual(["Beta Teller"])
          const page = await api.get("/admin/medusify/products?limit=2&offset=1", h())
          expect(titles(page)).toEqual(["Beta Teller", "Gamma Kanne"])
          expect(page.data.count).toBe(3)
          await expect(api.get("/admin/medusify/products?limit=1000", h())).rejects.toMatchObject({ response: { status: 400 } })
        })

        it("subtracts what is reserved, and shows a kit and an untracked variant as not editable / without a total", async () => {
          const kit = await createCatalogProduct(getContainer(), { title: "Kit", required_quantity: 2, levels: [{ location_id: locA, quantity: 9 }] })
          const untracked = await createCatalogProduct(getContainer(), { title: "Digital", manage_inventory: false, noInventory: true })
          const reserved = await createCatalogProduct(getContainer(), { title: "Reserviert", levels: [{ location_id: locA, quantity: 10 }] })
          await getContainer().resolve(Modules.INVENTORY).createReservationItems({ inventory_item_id: reserved.inventoryItemId!, location_id: locA, quantity: 3 })
          const res = await api.get("/admin/medusify/products?limit=10", h())
          const by = (t: string) => res.data.products.find((x: any) => x.title === t).variants[0]
          // 9 units of an item that takes 2 per sale ⇒ 4 sales
          expect(by("Kit")).toMatchObject({ stock_total: 4, stock_editable: false })
          expect(by("Digital")).toMatchObject({ manage_inventory: false, stock_total: null, stock_editable: false })
          expect(by("Reserviert")).toMatchObject({ stock_total: 7, stock_editable: true })
          expect(by("Reserviert").inventory[0].levels[0]).toMatchObject({ stocked: 10, reserved: 3, available: 7 })
          expect(kit.productId && untracked.productId).toBeTruthy()
        })
      })

      describe("GET /admin/medusify/products/:id", () => {
        it("returns one product, 404 for an unknown one", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 2 }] })
          const res = await api.get(`/admin/medusify/products/${p.productId}`, h())
          expect(res.data.product).toMatchObject({ id: p.productId, title: "Demo Tasse" })
          await expect(api.get("/admin/medusify/products/prod_nope", h())).rejects.toMatchObject({ response: { status: 404 } })
        })
      })

      describe("GET /admin/medusify/variants/lookup", () => {
        const lookup = async (code: string) => (await api.get(`/admin/medusify/variants/lookup?code=${encodeURIComponent(code)}`, h())).data.matches as any[]

        it("finds a variant by barcode, SKU, EAN and UPC, and says which field matched", async () => {
          const p = await createCatalogProduct(getContainer(), { sku: "SKU-77", barcode: "BAR-1", ean: "4006381333931", upc: "036000291452", levels: [{ location_id: locA, quantity: 5 }] })
          for (const [code, field] of [["BAR-1", "barcode"], ["SKU-77", "sku"], ["4006381333931", "ean"], ["036000291452", "upc"]] as const) {
            const [m, ...rest] = await lookup(code)
            expect(rest).toEqual([])
            expect(m).toMatchObject({ matched_by: field, product: { id: p.productId, title: "Demo Tasse" }, variant: { id: p.variantId, stock_total: 5 } })
          }
          expect(await lookup("0000000000000")).toEqual([])
        })

        it("a UPC-A (12 digits) and its EAN-13 twin (leading 0) find each other", async () => {
          const a = await createCatalogProduct(getContainer(), { title: "Stored as UPC", upc: "036000291452" })
          const b = await createCatalogProduct(getContainer(), { title: "Stored as EAN", ean: "0012345678905" })
          expect((await lookup("0036000291452")).map((m) => m.product.id)).toEqual([a.productId])
          expect((await lookup("012345678905")).map((m) => m.product.id)).toEqual([b.productId])
        })

        it("when a code fits several variants the barcode match comes before SKU, EAN and UPC", async () => {
          const bySku = await createCatalogProduct(getContainer(), { title: "AAA by sku", sku: "SAME-CODE" })
          const byBarcode = await createCatalogProduct(getContainer(), { title: "ZZZ by barcode", barcode: "SAME-CODE" })
          const matches = await lookup("SAME-CODE")
          expect(matches.map((m) => [m.matched_by, m.product.id])).toEqual([
            ["barcode", byBarcode.productId],
            ["sku", bySku.productId],
          ])
        })

        it("refuses an empty code", async () => {
          await expect(api.get("/admin/medusify/variants/lookup?code=", h())).rejects.toMatchObject({ response: { status: 400 } })
        })
      })

      describe("POST /admin/medusify/variants/:id/price", () => {
        const setPrice = (variantId: string, body: Record<string, unknown>) => api.post(`/admin/medusify/variants/${variantId}/price`, body, h())
        const detail = async (productId: string) => (await api.get(`/admin/medusify/products/${productId}`, h())).data.product.variants[0]

        it("changes the price of one currency and leaves the other prices, the region price and the quantity tier as they were", async () => {
          const region = await createRegion(getContainer(), "eur", "at")
          const p = await createCatalogProduct(getContainer(), {
            levels: [{ location_id: locA, quantity: 1 }],
            prices: [
              { currency_code: "eur", amount: 12.5 },
              { currency_code: "usd", amount: 14 },
              { currency_code: "eur", amount: 11, rules: { region_id: region.id } },
              { currency_code: "eur", amount: 10, min_quantity: 5, max_quantity: 10 },
            ],
          })
          const before = (await detail(p.productId)).prices as any[]
          expect(before).toHaveLength(4)
          const res = await setPrice(p.variantId, { currency_code: "EUR", amount: 19.99 })
          expect(res.status).toBe(200)
          const after = (await detail(p.productId)).prices as any[]
          expect(after).toHaveLength(4)
          expect(res.data.prices).toEqual(after)
          const plain = (list: any[], cur: string) => list.find((x) => x.currency_code === cur && x.base)
          expect(plain(after, "eur").amount).toBe(19.99)
          expect(plain(after, "usd").amount).toBe(14)
          // the region price and the tier are still there with their amounts
          expect(after.filter((x) => !x.base).map((x) => x.amount).sort()).toEqual([10, 11])
          // and the price rule of the region price is intact
          const { data } = await query().graph({ entity: "variant", fields: ["price_set.prices.amount", "price_set.prices.rules_count"], filters: { id: p.variantId } })
          const ruled = (data[0] as any).price_set.prices.filter((x: any) => x.rules_count > 0)
          expect(ruled).toHaveLength(1)
          expect(Number(ruled[0].amount?.value ?? ruled[0].amount)).toBe(11)
        })

        it("a sale price (a price list) is neither shown as the variant's price nor touched by a change", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 1 }] })
          const { data } = await query().graph({ entity: "variant", fields: ["price_set.id"], filters: { id: p.variantId } })
          const priceSetId = (data[0] as any).price_set.id
          const pricing = getContainer().resolve(Modules.PRICING) as any
          const [list] = await pricing.createPriceLists([
            { title: "Sale", description: "Sale", type: "sale", status: "active", prices: [{ amount: 7, currency_code: "eur", price_set_id: priceSetId }] },
          ])
          const g = await query().graph({ entity: "variant", fields: ["price_set.prices.id", "price_set.prices.price_list_id"], filters: { id: p.variantId } })
          // Measured on 2.22.7: the price set of a variant does not list the prices of a price list. The plugin filters them out
          // anyway (catalog.ts), so a Medusa that starts listing them does not make them look like the variant's own price.
          expect((g.data[0] as any).price_set.prices.map((x: any) => x.price_list_id)).toEqual([null])
          expect(((await detail(p.productId)).prices as any[]).map((x) => [x.currency_code, x.amount, x.base])).toEqual([["eur", 12.5, true]])
          const res = await setPrice(p.variantId, { currency_code: "eur", amount: 13 })
          expect(res.data.prices.map((x: any) => [x.currency_code, x.amount])).toEqual([["eur", 13]])
          // the sale price is still in its list, with its amount
          const kept = await pricing.listPrices({ price_list_id: list.id })
          expect(kept.map((x: any) => Number(x.amount?.value ?? x.amount))).toEqual([7])
        })

        it("adds a currency the variant has no plain price in yet", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 1 }] })
          await setPrice(p.variantId, { currency_code: "usd", amount: 15 })
          const prices = (await detail(p.productId)).prices as any[]
          expect(prices.map((x) => [x.currency_code, x.amount, x.base])).toEqual([["eur", 12.5, true], ["usd", 15, true]])
        })

        it("two changes of two currencies at the same moment both stay", async () => {
          // Six currencies at once: without the lock per variant the reads overlap and the last write drops the others' changes.
          const codes = ["eur", "usd", "gbp", "chf", "sek", "dkk"]
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 1 }], prices: codes.map((c, i) => ({ currency_code: c, amount: i + 1 })) })
          const answers = await Promise.all(codes.map((c, i) => setPrice(p.variantId, { currency_code: c, amount: (i + 1) * 10 })))
          expect(answers.map((a) => a.status)).toEqual(codes.map(() => 200))
          const prices = (await detail(p.productId)).prices as any[]
          expect(prices.map((x) => [x.currency_code, x.amount]).sort()).toEqual(codes.map((c, i) => [c, (i + 1) * 10]).sort())
        })

        it("refuses more decimals than the currency has, a negative amount, and an unknown variant", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 1 }], prices: [{ currency_code: "jpy", amount: 1000 }, { currency_code: "eur", amount: 5 }] })
          const bad = async (body: Record<string, unknown>, status: number, id = p.variantId) =>
            expect((await setPrice(id, body).catch((e) => e.response)).status).toBe(status)
          await bad({ currency_code: "eur", amount: 19.999 }, 400)
          await bad({ currency_code: "jpy", amount: 10.5 }, 400)
          await bad({ currency_code: "eur", amount: -1 }, 400)
          await bad({ currency_code: "eur", amount: 5 }, 404, "variant_nope")
          await setPrice(p.variantId, { currency_code: "jpy", amount: 1200 })
          expect(((await detail(p.productId)).prices as any[]).find((x) => x.currency_code === "jpy").amount).toBe(1200)
        })
      })

      describe("POST /admin/medusify/inventory", () => {
        it("sets a count (delta against what is there), adds and takes away, and reads back at once", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const i = p.inventoryItemId!
          const set = await stock({ mode: "set", inventory_item_id: i, location_id: locA, quantity: 7, idempotency_key: key() })
          expect(set.data).toMatchObject({ stocked: 7, reserved: 0, available: 7, delta: -3, replayed: false })
          expect(await stocked(i)).toBe(7)
          expect((await stock({ mode: "adjust", inventory_item_id: i, location_id: locA, quantity: 1, idempotency_key: key() })).data).toMatchObject({ stocked: 8, delta: 1 })
          expect((await stock({ mode: "adjust", inventory_item_id: i, location_id: locA, quantity: -2, idempotency_key: key() })).data).toMatchObject({ stocked: 6, delta: -2 })
          // the list shows the new number
          const view = (await api.get(`/admin/medusify/products/${p.productId}`, h())).data.product.variants[0]
          expect(view.stock_total).toBe(6)
        })

        it("a repeat with the same key changes nothing and says so", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const body = { mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1, idempotency_key: key("scan") }
          const first = await stock(body)
          const again = await stock(body)
          expect(first.data).toMatchObject({ stocked: 11, delta: 1, replayed: false })
          expect(again.data).toMatchObject({ stocked: 11, delta: 0, replayed: true })
          expect(await stocked(p.inventoryItemId!)).toBe(11)
        })

        it("the same key twice at the same moment writes once", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const body = { mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1, idempotency_key: key("double") }
          const [a, b] = await Promise.all([stock(body), stock(body)])
          expect([a.data.replayed, b.data.replayed].sort()).toEqual([false, true])
          expect(await stocked(p.inventoryItemId!)).toBe(11)
        })

        it("different keys at the same moment (two phones) both count", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const one = () => stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1, idempotency_key: key() })
          await Promise.all([one(), one(), one(), one()])
          expect(await stocked(p.inventoryItemId!)).toBe(14)
        })

        it("refuses to go below zero and changes nothing", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 2 }] })
          const res = await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: -3, idempotency_key: key() }).catch((e) => e.response)
          expect(res.status).toBe(400)
          expect(res.data.message).toBe("medusify:below_zero")
          expect(await stocked(p.inventoryItemId!)).toBe(2)
          expect(await push().listMedusifyOperations({}, { take: null })).toHaveLength(0)
        })

        it("takes back exactly what the earlier request changed, once", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const k = key("plus")
          await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 3, idempotency_key: k })
          // somebody else changes the stock in between: the undo takes back the three units, not "the old number"
          await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 5, idempotency_key: key() })
          const undo = await stock({ mode: "undo", undo_of: k, idempotency_key: key("undo") })
          expect(undo.data).toMatchObject({ stocked: 15, delta: -3, replayed: false })
          const second = await stock({ mode: "undo", undo_of: k, idempotency_key: key("undo") })
          expect(second.data).toMatchObject({ stocked: 15, delta: 0, replayed: true })
          expect(await stocked(p.inventoryItemId!)).toBe(15)
        })

        it("when the record of a change cannot be written, the change is taken back, and the retry books it once", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const k = key("rec")
          const spy = jest.spyOn(push(), "createMedusifyOperations").mockRejectedValueOnce(new Error("db gone"))
          await expect(stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 3, idempotency_key: k })).rejects.toMatchObject({ response: { status: 500 } })
          spy.mockRestore()
          expect(await stocked(p.inventoryItemId!)).toBe(10)
          expect((await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 3, idempotency_key: k })).data).toMatchObject({ stocked: 13, replayed: false })
          expect(await stocked(p.inventoryItemId!)).toBe(13)
        })

        it("when the record was stored but its answer got lost, the change stays and a retry is a repeat", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const k = key("lostrec")
          const svc = push()
          const real = svc.createMedusifyOperations.bind(svc)
          const spy = jest.spyOn(svc, "createMedusifyOperations").mockImplementationOnce(async (...a: unknown[]) => {
            await real(...a)
            throw new Error("answer lost after commit")
          })
          expect((await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 3, idempotency_key: k })).data).toMatchObject({ stocked: 13, delta: 3 })
          spy.mockRestore()
          expect((await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 3, idempotency_key: k })).data).toMatchObject({ stocked: 13, replayed: true })
          expect(await stocked(p.inventoryItemId!)).toBe(13)
        })

        it("two undos of the same change with different keys at the same moment take it back once", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const k = key("plus")
          await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 3, idempotency_key: k })
          const answers = await Promise.all([1, 2, 3].map(() => stock({ mode: "undo", undo_of: k, idempotency_key: key("undo") })))
          expect(answers.map((a) => a.data.delta).sort()).toEqual([-3, 0, 0])
          expect(await stocked(p.inventoryItemId!)).toBe(10)
        })

        it("an undo of a count takes back the difference the count made", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const k = key("count")
          await stock({ mode: "set", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 4, idempotency_key: k })
          await stock({ mode: "undo", undo_of: k, idempotency_key: key() })
          expect(await stocked(p.inventoryItemId!)).toBe(10)
        })

        it("an undo for a request that never landed leaves a marker: the request that arrives late changes nothing", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const lost = key("lost")
          const undo = await stock({ mode: "undo", undo_of: lost, idempotency_key: key() }).catch((e) => e.response)
          expect(undo.status).toBe(404)
          expect(undo.data.message).toBe("medusify:nothing_to_undo")
          const late = await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1, idempotency_key: lost })
          expect(late.data).toMatchObject({ replayed: true, delta: 0 })
          expect(await stocked(p.inventoryItemId!)).toBe(10)
        })

        it("creates a missing level at a location (without Medusa's RBAC every admin may)", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 3 }] })
          expect(await level(p.inventoryItemId!, locB)).toBeUndefined()
          const res = await stock({ mode: "set", inventory_item_id: p.inventoryItemId, location_id: locB, quantity: 6, idempotency_key: key() })
          expect(res.data).toMatchObject({ stocked: 6, delta: 6 })
          expect(await stocked(p.inventoryItemId!, locB)).toBe(6)
          expect(await stocked(p.inventoryItemId!, locA)).toBe(3)
        })

        it("answers 404 for an unknown item and 400 for bad bodies", async () => {
          const bad = async (body: Record<string, unknown>, status: number) => expect((await stock(body).catch((e) => e.response)).status).toBe(status)
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 3 }] })
          await bad({ mode: "set", inventory_item_id: "iitem_nope", location_id: locA, quantity: 1, idempotency_key: key() }, 404)
          await bad({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 0, idempotency_key: key() }, 400)
          await bad({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1.5, idempotency_key: key() }, 400)
          await bad({ mode: "set", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: -1, idempotency_key: key() }, 400)
          await bad({ mode: "set", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1 }, 400)
          await bad({ mode: "set", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1, idempotency_key: "short" }, 400)
          await bad({ mode: "nonsense", idempotency_key: key() }, 400)
        })

        it("emits inventory-level.updated with the level id and the app as source (so the low-stock push can skip it)", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const bus = getContainer().resolve(Modules.EVENT_BUS) as any
          const emit = jest.spyOn(bus, "emit")
          await stock({ mode: "adjust", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 1, idempotency_key: key() })
          const levelId = (await level(p.inventoryItemId!, locA))!.id
          const sent = emit.mock.calls.flatMap((c: any[]) => (Array.isArray(c[0]) ? c[0] : [c[0]]))
          expect(sent.filter((m: any) => m.name === "inventory-level.updated").map((m: any) => m.data)).toEqual([{ id: levelId, source: "medusify" }])
          emit.mockRestore()
        })

        it("a zero change (count equals what is there) writes nothing but remembers the key", async () => {
          const p = await createCatalogProduct(getContainer(), { levels: [{ location_id: locA, quantity: 10 }] })
          const k = key()
          const first = await stock({ mode: "set", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 10, idempotency_key: k })
          expect(first.data).toMatchObject({ delta: 0, replayed: false, stocked: 10 })
          const second = await stock({ mode: "set", inventory_item_id: p.inventoryItemId, location_id: locA, quantity: 3, idempotency_key: k })
          expect(second.data).toMatchObject({ replayed: true, stocked: 10 })
        })
      })

      describe("POST /admin/medusify/products (quick create)", () => {
        const create = (body: Record<string, unknown>) => api.post("/admin/medusify/products", body, h())
        const body = (over: Record<string, unknown> = {}) => ({
          title: "Neue Kerze",
          status: "draft",
          price: { currency_code: "eur", amount: 9.9 },
          stock: { location_id: locA, quantity: 12 },
          idempotency_key: key("new"),
          ...over,
        })

        it("creates product, variant, price, photo and stock in one request", async () => {
          const res = await create(body({ status: "published", image_url: "https://files.example.invalid/kerze.jpg" }))
          expect(res.status).toBe(201)
          expect(res.data).toMatchObject({ product_id: expect.any(String), variant_id: expect.any(String), replayed: false })
          const { product } = (await api.get(`/admin/medusify/products/${res.data.product_id}`, h())).data
          expect(product).toMatchObject({ title: "Neue Kerze", status: "published", thumbnail: "https://files.example.invalid/kerze.jpg" })
          const [variant] = product.variants
          expect(variant).toMatchObject({ id: res.data.variant_id, manage_inventory: true, stock_total: 12, stock_editable: true })
          expect(variant.prices.map((x: any) => [x.currency_code, x.amount])).toEqual([["eur", 9.9]])
          expect(variant.inventory[0].levels).toEqual([expect.objectContaining({ location_id: locA, location_name: "Lager Wien", stocked: 12 })])
        })

        it("a draft stays a draft", async () => {
          const res = await create(body())
          expect((await api.get(`/admin/medusify/products/${res.data.product_id}`, h())).data.product.status).toBe("draft")
        })

        it("a repeat with the same key answers with the same product and creates no second one", async () => {
          const b = body()
          const first = await create(b)
          const again = await create(b)
          expect(again.status).toBe(200)
          expect(again.data).toEqual({ product_id: first.data.product_id, variant_id: first.data.variant_id, replayed: true })
          expect((await api.get("/admin/medusify/products", h())).data.count).toBe(1)
        })

        it("the same key twice at the same moment creates one product", async () => {
          const b = body()
          const [x, y] = await Promise.all([create(b), create(b)])
          expect(x.data.product_id).toBe(y.data.product_id)
          expect((await api.get("/admin/medusify/products", h())).data.count).toBe(1)
        })

        it("an unknown location is refused before anything is written", async () => {
          const res = await create(body({ stock: { location_id: "sloc_nope", quantity: 1 } })).catch((e) => e.response)
          expect(res.status).toBe(404)
          expect(res.data.message).toBe("medusify:no_location")
          expect((await api.get("/admin/medusify/products", h())).data.count).toBe(0)
          const { data } = await query().graph({ entity: "inventory_item", fields: ["id"] })
          expect(data).toHaveLength(0)
        })

        it("a currency the shop does not sell in is refused", async () => {
          const store = getContainer().resolve(Modules.STORE) as any
          const [s] = await store.listStores({}, { take: 1 })
          if (s) await store.updateStores(s.id, { supported_currencies: [{ currency_code: "eur", is_default: true }] })
          else await store.createStores({ name: "Testshop", supported_currencies: [{ currency_code: "eur", is_default: true }] })
          const res = await create(body({ price: { currency_code: "usd", amount: 5 } })).catch((e) => e.response)
          expect(res.status).toBe(400)
          expect(res.data.message).toBe("medusify:currency_not_supported")
          expect((await create(body())).status).toBe(201)
        })

        it("a failure in the middle rolls the earlier steps back: no inventory item without a product", async () => {
          const products = getContainer().resolve(Modules.PRODUCT) as any
          const spy = jest.spyOn(products, "createProducts").mockRejectedValueOnce(new Error("product module down"))
          const b = body()
          const res = await create(b).catch((e) => e.response)
          expect(spy).toHaveBeenCalledTimes(1) // the failure really happened in the product step, after the inventory item was made
          spy.mockRestore()
          expect(res.status).toBe(500)
          const { data } = await query().graph({ entity: "inventory_item", fields: ["id"] })
          expect(data).toHaveLength(0)
          expect((await api.get("/admin/medusify/products", h())).data.count).toBe(0)
          // the key was not used up: the same request works now
          expect((await create(b)).status).toBe(201)
        })

        it("refuses an empty title, a negative price or stock, a bad photo link and a missing key", async () => {
          const bad = async (over: Record<string, unknown>) => expect((await create(body(over)).catch((e) => e.response)).status).toBe(400)
          await bad({ title: "   " })
          await bad({ price: { currency_code: "eur", amount: -1 } })
          await bad({ stock: { location_id: locA, quantity: -1 } })
          await bad({ stock: { location_id: locA, quantity: 1.5 } })
          await bad({ image_url: "javascript:alert(1)" })
          await bad({ status: "archived" })
          await bad({ idempotency_key: undefined })
        })
      })

    })
  },
})
