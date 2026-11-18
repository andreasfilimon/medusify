/**
 * Demo data only: an inventory kit and paid orders for it, so the ship flow can be tried on a kit.
 *
 * The product "Teeset Duo" has one variant that is built from two inventory items: 2 x "Teekanne Demo" and
 * 1 x "Teetasse Demo" (`required_quantity` 2 and 1). Ordering 3 sets reserves 6 pots and 3 cups; a fulfillment of
 * one set holds the items with quantity 2 and 1, one of two sets with 4 and 2. Medusa divides by `required_quantity`
 * when it registers the shipment, a client that sums the item quantities of a fulfillment gets this wrong.
 *
 * `createOrderWorkflow` creates no stock reservations (the cart completion does), so the script creates them itself with
 * the same shape: one reservation per inventory item and order line, quantity = line quantity x required quantity.
 *
 *   npx medusa exec ./src/scripts/seed-demo-kit.ts
 *
 * The product and the stock are created once. `SEED_KIT_ORDERS=<n>` (default 1) adds that many orders of 3 sets each,
 * paid and not yet fulfilled, on every run (the end-to-end tests ask for fresh ones).
 */
import {
  createInventoryItemsWorkflow,
  createInventoryLevelsWorkflow,
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  createProductsWorkflow,
  createReservationsWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

const HANDLE = "teeset-duo-demo"
const KIT = [
  { sku: "DEMO-KIT-POT", title: "Teekanne Demo", required_quantity: 2 },
  { sku: "DEMO-KIT-CUP", title: "Teetasse Demo", required_quantity: 1 },
] as const
const SETS_PER_ORDER = 3
const MARK = "medusify_demo_kit"

export default async function seedDemoKit({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "currency_code"] })
  const eur = regions.find((r) => r.currency_code === "eur")
  const { data: channels } = await query.graph({ entity: "sales_channel", fields: ["id"] })
  const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"] })
  const { data: options } = await query.graph({ entity: "shipping_option", fields: ["id", "name"] })
  const { data: profiles } = await query.graph({ entity: "shipping_profile", fields: ["id"] })
  const standard = options.find((o) => o.name === "Standard Shipping") ?? options[0]
  if (!eur || !channels[0] || !locations[0] || !standard || !profiles[0]) {
    throw new Error("Region, sales channel, stock location, shipping option or profile is missing: run the initial data seed first")
  }
  const location = locations[0]

  // 1. inventory items and stock, once
  const { data: known } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: { sku: KIT.map((k) => k.sku) },
  })
  let items = known as { id: string; sku: string }[]
  if (items.length < KIT.length) {
    const missing = KIT.filter((k) => !items.some((i) => i.sku === k.sku))
    const { result } = await createInventoryItemsWorkflow(container).run({
      input: { items: missing.map((k) => ({ sku: k.sku, title: k.title, requires_shipping: true })) },
    })
    items = [...items, ...(result as { id: string; sku: string }[])]
    await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: (result as { id: string }[]).map((i) => ({ inventory_item_id: i.id, location_id: location.id, stocked_quantity: 1000 })) },
    })
    logger.info(`Kit inventory items created: ${missing.map((k) => k.sku).join(", ")}`)
  }
  const itemId = (sku: string) => items.find((i) => i.sku === sku)!.id

  // 2. product with one kit variant, once
  const { data: found } = await query.graph({ entity: "product", fields: ["id", "variants.id"], filters: { handle: HANDLE } })
  let variantId = (found[0] as { variants?: { id: string }[] } | undefined)?.variants?.[0]?.id
  if (!variantId) {
    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: "Teeset Duo",
            handle: HANDLE,
            status: "published",
            shipping_profile_id: profiles[0].id,
            sales_channels: [{ id: channels[0].id }],
            options: [{ title: "Set", values: ["Standard"] }],
            variants: [
              {
                title: "Standard",
                sku: "DEMO-KIT-SET",
                manage_inventory: true,
                options: { Set: "Standard" },
                prices: [{ currency_code: "eur", amount: 39 }],
                inventory_items: KIT.map((k) => ({ inventory_item_id: itemId(k.sku), required_quantity: k.required_quantity })),
              },
            ],
          },
        ],
      } as any,
    })
    variantId = (result[0] as any).variants[0].id as string
    logger.info("Kit product created")
  }

  // 3. orders
  const count = Number(process.env.SEED_KIT_ORDERS ?? 1)
  for (let n = 0; n < count; n++) {
    const { result: order } = await createOrderWorkflow(container).run({
      input: {
        region_id: eur.id,
        currency_code: "eur",
        sales_channel_id: channels[0].id,
        email: `kit.kaeufer${Date.now()}${n}@example.invalid`,
        metadata: { [MARK]: true },
        items: [{ variant_id: variantId, quantity: SETS_PER_ORDER, unit_price: 39 }],
        shipping_methods: [{ name: "Standard Shipping", amount: 4.9, shipping_option_id: standard.id }],
        shipping_address: { first_name: "Kit", last_name: "Kaeufer", address_1: "Beispielgasse 1", city: "Wien", country_code: "at", postal_code: "1010" },
      } as any,
    })
    const { data: lines } = await query.graph({ entity: "order", fields: ["id", "items.id"], filters: { id: order.id } })
    const lineId = (lines[0] as any).items[0].id as string
    await createReservationsWorkflow(container).run({
      input: {
        reservations: KIT.map((k) => ({
          line_item_id: lineId,
          inventory_item_id: itemId(k.sku),
          location_id: location.id,
          quantity: SETS_PER_ORDER * k.required_quantity,
        })),
      },
    })
    const total = SETS_PER_ORDER * 39 + 4.9
    const { result: pc } = await createOrderPaymentCollectionWorkflow(container).run({
      input: { order_id: order.id, amount: Math.round(total * 100) / 100 },
    })
    await markPaymentCollectionAsPaid(container).run({
      input: { order_id: order.id, payment_collection_id: (pc as any)[0].id, captured_by: "usr_demo" },
    })
    await pg.raw('update "order" set created_at = ? where id = ?', [new Date(Date.now() - 60_000).toISOString(), order.id])
    logger.info(`Kit order #${(order as any).display_id}: ${SETS_PER_ORDER} sets, paid, not fulfilled (${order.id}, line ${lineId})`)
  }
}
