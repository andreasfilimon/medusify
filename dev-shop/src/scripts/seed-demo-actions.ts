/**
 * Demo data only (invented buyers, `.invalid` addresses). Creates four fresh orders for the end-to-end run of the order
 * actions, one for each flow, and writes their ids to `.e2e-actions.json` (git-ignored):
 *
 *   authorized  a payment that is authorized and not captured       -> capture
 *   refund      paid, nothing shipped, 39.00                         -> partial refund
 *   cancel      paid, nothing shipped                                -> cancel (Medusa refunds the captured money)
 *   ret         paid and shipped, three units                        -> return with refund
 *
 * Every run makes new orders (the actions consume them), so the run is repeatable:
 *
 *   npx medusa exec ./src/scripts/seed-demo-actions.ts
 */
import {
  createOrderFulfillmentWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderShipmentWorkflow,
  createOrderWorkflow,
  createPaymentSessionsWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

const MARK = "medusify_demo_actions"

type Line = { title: string; quantity: number; unit_price: number }
type Flow = "authorized" | "refund" | "cancel" | "ret"

const PLAN: { flow: Flow; buyer: [string, string]; items: Line[]; shipping: number }[] = [
  { flow: "authorized", buyer: ["Aria", "Autorisiert"], items: [{ title: "Teesieb Edelstahl", quantity: 2, unit_price: 9.9 }], shipping: 4.9 },
  { flow: "refund", buyer: ["Rita", "Rueckzahlung"], items: [{ title: "Duftkerzen-Set", quantity: 1, unit_price: 39 }], shipping: 0 },
  { flow: "cancel", buyer: ["Karl", "Storno"], items: [{ title: "Teemischung Nordlicht", quantity: 1, unit_price: 12.9 }], shipping: 4.9 },
  { flow: "ret", buyer: ["Rosa", "Retoure"], items: [{ title: "Bienenwachskerze klein", quantity: 2, unit_price: 6.5 }, { title: "Streichholzbox", quantity: 1, unit_price: 3.2 }], shipping: 4.9 },
]

export default async function seedDemoActions({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const paymentModule = container.resolve(Modules.PAYMENT)

  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "currency_code"] })
  const eur = regions.find((r) => r.currency_code === "eur")
  const { data: channels } = await query.graph({ entity: "sales_channel", fields: ["id"] })
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"] })
  const { data: options } = await query.graph({ entity: "shipping_option", fields: ["id", "name"] })
  const standard = options.find((o) => o.name === "Standard Shipping") ?? options[0]
  if (!eur || !channels[0] || !locations[0] || !standard) throw new Error("Run the initial data seed first (EUR region, channel, location, shipping option)")

  const out: Record<string, { id: string; display_id: number; total: number }> = {}

  for (const p of PLAN) {
    const [first, last] = p.buyer
    const { result: order } = await createOrderWorkflow(container).run({
      input: {
        region_id: eur.id,
        currency_code: "eur",
        sales_channel_id: channels[0].id,
        email: `${first}.${last}@example.invalid`.toLowerCase(),
        metadata: { [MARK]: true },
        // Goods to post: without the flag a custom line counts as not needing shipping (like a voucher), and a
        // shipment marks it delivered instead of shipped (measured 2026-11-19).
        items: p.items.map((i) => ({ ...i, requires_shipping: true })),
        shipping_methods: [{ name: "Standard Shipping", amount: p.shipping, shipping_option_id: standard.id }],
        shipping_address: { first_name: first, last_name: last, address_1: "Beispielgasse 1", city: "Wien", country_code: "at", postal_code: "1010", phone: "+43 660 0000000" },
      } as any,
    })
    const total = Math.round((p.items.reduce((s, i) => s + i.quantity * i.unit_price, 0) + p.shipping) * 100) / 100
    const { result: pc } = await createOrderPaymentCollectionWorkflow(container).run({ input: { order_id: order.id, amount: total } })
    const collectionId = (pc as any)[0].id as string

    if (p.flow === "authorized") {
      const { result: session } = await createPaymentSessionsWorkflow(container).run({
        input: { payment_collection_id: collectionId, provider_id: "pp_system_default" },
      })
      await paymentModule.authorizePaymentSession((session as any).id, {})
    } else {
      await markPaymentCollectionAsPaid(container).run({ input: { order_id: order.id, payment_collection_id: collectionId, captured_by: "usr_demo" } })
    }

    if (p.flow === "ret") {
      const { data: full } = await query.graph({ entity: "order", fields: ["id", "items.id", "items.quantity"], filters: { id: order.id } })
      const lines = ((full[0] as any).items as { id: string; quantity: number }[]).map((l) => ({ id: l.id, quantity: Number(l.quantity) }))
      const { result: f } = await createOrderFulfillmentWorkflow(container).run({
        input: { order_id: order.id, items: lines, location_id: locations[0].id, no_notification: true } as any,
      })
      await createOrderShipmentWorkflow(container).run({
        input: { order_id: order.id, fulfillment_id: (f as any).id, items: lines, labels: [{ tracking_number: "RR000000001AT", tracking_url: "", label_url: "" }], no_notification: true } as any,
      })
    }

    out[p.flow] = { id: order.id, display_id: (order as any).display_id, total }
    logger.info(`Action demo order #${(order as any).display_id} ${p.flow} eur ${total.toFixed(2)}`)
  }

  writeFileSync(join(process.cwd(), ".e2e-actions.json"), JSON.stringify(out, null, 2))
}
