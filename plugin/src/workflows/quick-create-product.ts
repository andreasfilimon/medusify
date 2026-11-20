import { createInventoryItemsWorkflow, createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"

export type QuickProduct = {
  key: string
  title: string
  status: "draft" | "published"
  currency_code: string
  amount: number
  location_id: string
  quantity: number
  image_url?: string
}

type Defaults = { sales_channel_id: string | null; shipping_profile_id: string | null }

/**
 * The shop's defaults for a new product: the default sales channel of the store (a published product without one is not
 * for sale anywhere) and the default shipping profile (without one it cannot be shipped). The currency must be one the
 * store supports, the stock location must exist: both are refused before anything is written.
 */
export const resolveDefaultsStep = createStep(
  "medusify-resolve-product-defaults",
  async (input: { currency_code: string; location_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: stores } = await query.graph({ entity: "store", fields: ["default_sales_channel_id", "supported_currencies.currency_code"], pagination: { take: 1 } })
    const store = stores[0] as { default_sales_channel_id?: string | null; supported_currencies?: { currency_code: string }[] } | undefined
    const currencies = (store?.supported_currencies ?? []).map((c) => c.currency_code.toLowerCase())
    if (currencies.length && !currencies.includes(input.currency_code.toLowerCase())) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:currency_not_supported")
    }
    const { data: locations } = await query.graph({ entity: "stock_location", fields: ["id"], filters: { id: input.location_id } })
    if (locations.length === 0) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_location")
    const fulfillment = container.resolve(Modules.FULFILLMENT) as unknown as {
      listShippingProfiles(filter: Record<string, unknown>, config?: Record<string, unknown>): Promise<{ id: string; type?: string }[]>
    }
    const profiles = await fulfillment.listShippingProfiles({}, { take: 20 })
    const profile = profiles.find((p) => p.type === "default") ?? profiles[0]
    const defaults: Defaults = { sales_channel_id: store?.default_sales_channel_id ?? null, shipping_profile_id: profile?.id ?? null }
    return new StepResponse(defaults)
  }
)

/** Keeps the key and the new product together: a repeat of the request answers with this product. */
export const recordProductStep = createStep(
  "medusify-record-product",
  async (input: { key: string; product_id: string; variant_id: string }, { container }) => {
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    const op = await push.createMedusifyOperations({ key: input.key, kind: "product", result: { product_id: input.product_id, variant_id: input.variant_id } })
    return new StepResponse(op, op.id)
  },
  async (id, { container }) => {
    if (!id) return
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    await push.deleteMedusifyOperations([id])
  }
)

/**
 * Quick create from the phone: one product with one variant, the price, the photo, and the stock at one location, in one
 * request. Everything runs as one workflow, so a failure in the middle rolls the earlier steps back (Medusa's own
 * compensation) and the shop does not keep a half-made product. More (options, more variants, texts) is for the Medusa admin.
 */
export const quickCreateProductWorkflow = createWorkflow("medusify-quick-create-product", function (input: QuickProduct) {
  const defaults = resolveDefaultsStep({ currency_code: input.currency_code, location_id: input.location_id })
  const itemInput = transform({ input }, ({ input }) => ({
    items: [{ title: input.title, location_levels: [{ location_id: input.location_id, stocked_quantity: input.quantity }] }],
  }))
  const items = createInventoryItemsWorkflow.runAsStep({ input: itemInput })
  const productInput = transform({ input, defaults, items }, ({ input, defaults, items }) => ({
    products: [
      {
        title: input.title,
        status: input.status,
        ...(input.image_url ? { thumbnail: input.image_url, images: [{ url: input.image_url }] } : {}),
        ...(defaults.shipping_profile_id ? { shipping_profile_id: defaults.shipping_profile_id } : {}),
        ...(defaults.sales_channel_id ? { sales_channels: [{ id: defaults.sales_channel_id }] } : {}),
        options: [{ title: "Default option", values: ["Default"] }],
        variants: [
          {
            title: "Default",
            options: { "Default option": "Default" },
            manage_inventory: true,
            prices: [{ currency_code: input.currency_code.toLowerCase(), amount: input.amount }],
            inventory_items: [{ inventory_item_id: items[0]!.id, required_quantity: 1 }],
          },
        ],
      },
    ],
  }))
  const created = createProductsWorkflow.runAsStep({ input: productInput })
  const record = transform({ input, created }, ({ input, created }) => ({
    key: input.key,
    product_id: created[0]!.id,
    variant_id: created[0]!.variants?.[0]?.id ?? "",
  }))
  recordProductStep(record)
  return new WorkflowResponse(record)
})
