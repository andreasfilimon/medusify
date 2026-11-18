/**
 * Demo data only: invented buyers, invented products, `.invalid` addresses. Creates orders in every state the
 * Medusify app shows (to ship, shipped, partly shipped, canceled, payment pending, two currencies) and backdates them
 * so "today", "yesterday" and "this month" all have content. Safe to re-run: it does nothing once the marked orders exist.
 * `SEED_TO_SHIP_EXTRA=3` adds that many fresh to-ship orders instead (for repeatable end-to-end runs).
 *
 *   npx medusa exec ./src/scripts/seed-demo-orders.ts
 */
import {
  cancelOrderWorkflow,
  createOrderFulfillmentWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderShipmentWorkflow,
  createOrderWorkflow,
  createRegionsWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

const MARK = "medusify_demo"

type Line = { title: string; quantity: number; unit_price: number }
type Demo = {
  hoursAgo: number
  currency: "eur" | "usd"
  buyer: [first: string, last: string, city: string, country: string, zip: string]
  items: Line[]
  shipping: number
  state: "to_ship" | "shipped" | "partly_shipped" | "canceled" | "payment_pending"
  tracking?: string
}

/** Oldest first, so display ids grow with the age of the order. */
const DEMOS: Demo[] = [
  { hoursAgo: 190, currency: "eur", buyer: ["Greta", "Lindner", "Graz", "at", "8010"], items: [{ title: "Teemischung Nordlicht", quantity: 2, unit_price: 12.9 }], shipping: 4.9, state: "shipped", tracking: "RR123456785AT" },
  { hoursAgo: 145, currency: "eur", buyer: ["Jonas", "Weidinger", "Linz", "at", "4020"], items: [{ title: "Bienenwachskerze klein", quantity: 4, unit_price: 6.5 }, { title: "Streichholzbox", quantity: 1, unit_price: 3.2 }], shipping: 4.9, state: "shipped", tracking: "RR123456799AT" },
  { hoursAgo: 120, currency: "eur", buyer: ["Mira", "Hofer", "Salzburg", "at", "5020"], items: [{ title: "Lavendelkerze", quantity: 1, unit_price: 18 }], shipping: 4.9, state: "canceled" },
  { hoursAgo: 78, currency: "eur", buyer: ["Tobias", "Eder", "Wien", "at", "1020"], items: [{ title: "Teemischung Nordlicht", quantity: 1, unit_price: 12.9 }, { title: "Teesieb Edelstahl", quantity: 1, unit_price: 9.9 }], shipping: 4.9, state: "shipped", tracking: "RR123456802AT" },
  { hoursAgo: 51, currency: "eur", buyer: ["Lena", "Gruber", "Innsbruck", "at", "6020"], items: [{ title: "Duftkerzen-Set", quantity: 1, unit_price: 39 }], shipping: 0, state: "to_ship" },
  { hoursAgo: 27, currency: "eur", buyer: ["Paul", "Steiner", "Klagenfurt", "at", "9020"], items: [{ title: "Bienenwachskerze klein", quantity: 2, unit_price: 6.5 }], shipping: 4.9, state: "payment_pending" },
  { hoursAgo: 26, currency: "usd", buyer: ["Dana", "Whitfield", "Portland", "us", "97201"], items: [{ title: "Teemischung Nordlicht", quantity: 3, unit_price: 14.5 }], shipping: 9, state: "to_ship" },
  { hoursAgo: 8, currency: "eur", buyer: ["Sophie", "Aigner", "Wien", "at", "1070"], items: [{ title: "Lavendelkerze", quantity: 2, unit_price: 18 }, { title: "Streichholzbox", quantity: 3, unit_price: 3.2 }, { title: "Kerzenlöscher", quantity: 1, unit_price: 14 }], shipping: 4.9, state: "partly_shipped", tracking: "RR123456816AT" },
  { hoursAgo: 5, currency: "eur", buyer: ["Felix", "Bauer", "Wien", "at", "1030"], items: [{ title: "Teesieb Edelstahl", quantity: 1, unit_price: 9.9 }], shipping: 4.9, state: "to_ship" },
  { hoursAgo: 1.5, currency: "eur", buyer: ["Nora", "Pichler", "Graz", "at", "8020"], items: [{ title: "Duftkerzen-Set", quantity: 1, unit_price: 39 }, { title: "Teemischung Nordlicht", quantity: 1, unit_price: 12.9 }], shipping: 0, state: "to_ship" },
  { hoursAgo: 0.07, currency: "eur", buyer: ["Emil", "Wagner", "Wien", "at", "1090"], items: [{ title: "Bienenwachskerze klein", quantity: 6, unit_price: 6.5 }], shipping: 4.9, state: "to_ship" },
]

export default async function seedDemoOrders({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const extra = Number(process.env.SEED_TO_SHIP_EXTRA ?? 0)
  const { data: existing } = await query.graph({ entity: "order", fields: ["id", "metadata"] })
  const seeded = existing.some((o: any) => o.metadata?.[MARK])
  if (seeded && !extra) {
    logger.info("Demo orders already exist, nothing to do")
    return
  }
  const plan: Demo[] = seeded
    ? Array.from({ length: extra }, (_, i) => ({
        hoursAgo: 0.02,
        currency: "eur" as const,
        buyer: ["Test", `Käufer${i + 1}`, "Wien", "at", "1010"] as Demo["buyer"],
        items: [{ title: "Teesieb Edelstahl", quantity: 1, unit_price: 9.9 }],
        shipping: 4.9,
        state: "to_ship" as const,
      }))
    : DEMOS

  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "currency_code", "name"] })
  const eur = regions.find((r) => r.currency_code === "eur")
  if (!eur) throw new Error("No EUR region: run the initial data seed first (medusa db:migrate)")
  let usd = regions.find((r) => r.currency_code === "usd")
  if (!usd) {
    const { result } = await createRegionsWorkflow(container).run({
      input: { regions: [{ name: "United States", currency_code: "usd", countries: ["us"] }] },
    })
    usd = result[0] as any
  }
  const { data: channels } = await query.graph({ entity: "sales_channel", fields: ["id"] })
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"] })
  const { data: options } = await query.graph({ entity: "shipping_option", fields: ["id", "name"] })
  const standard = options.find((o) => o.name === "Standard Shipping") ?? options[0]
  if (!channels[0] || !locations[0] || !standard) throw new Error("Sales channel, stock location or shipping option is missing")

  for (const d of plan) {
    const region = d.currency === "usd" ? usd! : eur
    const [first, last, city, country, zip] = d.buyer
    const { result: order } = await createOrderWorkflow(container).run({
      input: {
        region_id: region.id,
        currency_code: d.currency,
        sales_channel_id: channels[0].id,
        email: `${first}.${last}@example.invalid`.toLowerCase(),
        metadata: { [MARK]: true },
        items: d.items,
        shipping_methods: [
          d.currency === "eur"
            ? { name: "Standard Shipping", amount: d.shipping, shipping_option_id: standard.id }
            : { name: "Flat rate", amount: d.shipping },
        ],
        shipping_address: { first_name: first, last_name: last, address_1: "Beispielgasse 1", city, country_code: country, postal_code: zip },
      } as any,
    })

    const total = d.items.reduce((s, i) => s + i.quantity * i.unit_price, 0) + d.shipping
    if (d.state !== "payment_pending" && d.state !== "canceled") {
      const { result: pc } = await createOrderPaymentCollectionWorkflow(container).run({
        input: { order_id: order.id, amount: Math.round(total * 100) / 100 },
      })
      await markPaymentCollectionAsPaid(container).run({
        input: { order_id: order.id, payment_collection_id: (pc as any)[0].id, captured_by: "usr_demo" },
      })
    }

    if (d.state === "shipped" || d.state === "partly_shipped") {
      const { data: full } = await query.graph({ entity: "order", fields: ["id", "items.id", "items.quantity"], filters: { id: order.id } })
      const lines = (full[0] as any).items as { id: string; quantity: number }[]
      // partly shipped: ship only the first line
      const shipLines = (d.state === "partly_shipped" ? lines.slice(0, 1) : lines).map((l) => ({ id: l.id, quantity: Number(l.quantity) }))
      const { result: f } = await createOrderFulfillmentWorkflow(container).run({
        input: { order_id: order.id, items: shipLines, location_id: locations[0].id, no_notification: true } as any,
      })
      await createOrderShipmentWorkflow(container).run({
        input: {
          order_id: order.id,
          fulfillment_id: (f as any).id,
          items: shipLines,
          labels: [{ tracking_number: d.tracking!, tracking_url: "", label_url: "" }],
          no_notification: true,
        } as any,
      })
    }

    if (d.state === "canceled") {
      await cancelOrderWorkflow(container).run({ input: { order_id: order.id } })
    }

    const at = new Date(Date.now() - d.hoursAgo * 3600_000).toISOString()
    await pg.raw('update "order" set created_at = ? where id = ?', [at, order.id])
    logger.info(`Demo order #${(order as any).display_id} ${d.state} ${d.currency} ${total.toFixed(2)}`)
  }
}
