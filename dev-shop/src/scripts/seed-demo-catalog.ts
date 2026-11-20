/**
 * Demo data only — invented products with stock at two invented locations and EAN-13 codes from the in-store range (20…),
 * for the app's catalog, stock and scanner screens. Nothing in the app depends on it.
 *
 *   npx medusa exec ./src/scripts/seed-demo-catalog.ts
 *
 * Re-running it is a no-op for what exists: products are keyed by handle, locations by name.
 */
import { createInventoryItemsWorkflow, createProductsWorkflow, createStockLocationsWorkflow } from '@medusajs/medusa/core-flows'
import { ContainerRegistrationKeys, ProductStatus } from '@medusajs/framework/utils'
import type { ExecArgs } from '@medusajs/framework/types'

/** EAN-13 with its check digit from the 12 digits before it. */
const ean = (twelve: string) => {
  const sum = [...twelve].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return twelve + String((10 - (sum % 10)) % 10)
}

type Demo = {
  handle: string
  title: string
  status: ProductStatus
  variants: { title: string; sku: string; barcode?: string; price: number; track: boolean; stock: { Wien?: number; Graz?: number } }[]
}

const DEMO: Demo[] = [
  { handle: 'demo-cat-kerze', title: 'Duftkerze Lavendel', status: ProductStatus.PUBLISHED, variants: [{ title: 'Default', sku: 'KERZE-LAV', barcode: ean('200000000000'), price: 14.9, track: true, stock: { Wien: 3 } }] },
  {
    handle: 'demo-cat-tasse',
    title: 'Teetasse Keramik',
    status: ProductStatus.PUBLISHED,
    variants: [
      { title: 'Blau', sku: 'TASSE-BLAU', barcode: ean('200000000001'), price: 12, track: true, stock: { Wien: 12, Graz: 4 } },
      { title: 'Grün', sku: 'TASSE-GRUEN', barcode: ean('200000000002'), price: 12, track: true, stock: { Wien: 8 } },
    ],
  },
  { handle: 'demo-cat-gutschein', title: 'Geschenkgutschein', status: ProductStatus.PUBLISHED, variants: [{ title: 'Default', sku: 'GUTSCHEIN', price: 25, track: false, stock: {} }] },
  { handle: 'demo-cat-muetze', title: 'Wintermütze Wolle', status: ProductStatus.DRAFT, variants: [{ title: 'Default', sku: 'MUETZE-W', barcode: ean('200000000003'), price: 29.9, track: true, stock: { Wien: 0 } }] },
]

export default async function seedDemoCatalog({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: existingLocations } = await query.graph({ entity: 'stock_location', fields: ['id', 'name'] })
  const places: Record<string, string> = {}
  for (const name of ['Lager Wien', 'Lager Graz']) {
    const found = existingLocations.find((l: { name?: string }) => l.name === name)
    if (found) places[name] = found.id as string
    else {
      const { result } = await createStockLocationsWorkflow(container).run({ input: { locations: [{ name }] } })
      places[name] = result[0]!.id
    }
  }

  const { data: salesChannels } = await query.graph({ entity: 'sales_channel', fields: ['id'] })
  const { data: profiles } = await query.graph({ entity: 'shipping_profile', fields: ['id'] })
  const { data: stores } = await query.graph({ entity: 'store', fields: ['supported_currencies.currency_code'] })
  const currencies: string[] = (stores[0]?.supported_currencies ?? []).map((c: { currency_code: string }) => c.currency_code)
  const { data: have } = await query.graph({ entity: 'product', fields: ['handle'], filters: { handle: DEMO.map((d) => d.handle) } })
  const haveHandles = new Set(have.map((p: { handle: string }) => p.handle))

  for (const d of DEMO) {
    if (haveHandles.has(d.handle)) continue
    const variants = []
    for (const v of d.variants) {
      let inventory: { inventory_item_id: string; required_quantity: number }[] = []
      if (v.track) {
        const levels = Object.entries(v.stock).map(([k, quantity]) => ({ location_id: places[`Lager ${k}`]!, stocked_quantity: quantity }))
        const { result } = await createInventoryItemsWorkflow(container).run({ input: { items: [{ sku: v.sku, title: `${d.title} ${v.title}`, location_levels: levels }] } })
        inventory = [{ inventory_item_id: result[0]!.id, required_quantity: 1 }]
      }
      variants.push({
        title: v.title,
        sku: v.sku,
        ...(v.barcode ? { barcode: v.barcode, ean: v.barcode } : {}),
        options: { Variante: v.title },
        manage_inventory: v.track,
        prices: (currencies.length ? currencies : ['eur']).map((currency_code) => ({ currency_code, amount: v.price })),
        ...(inventory.length ? { inventory_items: inventory } : {}),
      })
    }
    await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: d.title,
            handle: d.handle,
            status: d.status,
            shipping_profile_id: profiles[0]?.id as string,
            ...(salesChannels[0] ? { sales_channels: [{ id: salesChannels[0].id as string }] } : {}),
            options: [{ title: 'Variante', values: d.variants.map((v) => v.title) }],
            variants,
          },
        ],
      },
    })
    logger.info(`Demo product created: ${d.title}`)
  }
  logger.info('Demo catalog ready.')
}
