import {
  convertDraftOrderWorkflow,
  createOrUpdateOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  markPaymentCollectionAsPaid,
} from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import { toNumber, type Amount } from "../lib/bignum"
import type { MedusifyPushModuleService } from "../modules/medusify-push"

export type ManualAddress = {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address_1?: string | null
  address_2?: string | null
  postal_code?: string | null
  city?: string | null
  province?: string | null
  country_code?: string | null
  phone?: string | null
}

export type ManualOrder = {
  key: string
  region_id: string
  email: string | null
  customer_id: string | null
  items: { variant_id: string; quantity: number }[]
  shipping_option_id: string | null
  shipping_address: ManualAddress | null
  paid: boolean
  /** The admin user who marks it paid (Medusa records who captured). */
  actor_id: string
}

type Resolved = {
  currency_code: string
  sales_channel_id: string | null
  email: string
  shipping_methods: { shipping_option_id: string; name: string; amount: number }[]
}

type OptionPrice = { amount?: Amount; currency_code?: string; price_rules?: { attribute?: string; value?: string }[] | null }
type Option = { id: string; name?: string; price_type?: string; prices?: OptionPrice[] | null; rules?: { attribute?: string; value?: unknown }[] | null }

export const OPTION_FIELDS = ["id", "name", "price_type", "rules.attribute", "rules.value", "prices.amount", "prices.currency_code", "prices.price_rules.attribute", "prices.price_rules.value"]

/** A return option (Medusa marks it with the rule is_return = true) is for sending goods back, not for an order. */
export const isReturnOption = (o: Option) => (o.rules ?? []).some((r) => r.attribute === "is_return" && String(r.value) === "true")

export type OrderSetup = {
  regions: { id: string; name: string; currency_code: string; countries: { iso_2: string; name: string }[] }[]
  /** Flat options that are not for returns, each with its price per region (null: no price there, cannot be chosen). */
  shipping_options: { id: string; name: string; prices: Record<string, number | null> }[]
}

/**
 * GET /admin/medusify/orders/setup: what the form for an order by hand offers. The prices come from the same function
 * the workflow uses, so the app shows what the order will carry.
 */
export async function orderSetup(container: { resolve(key: string): unknown }): Promise<OrderSetup> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as { graph(q: Record<string, unknown>): Promise<{ data: unknown[] }> }
  const { data: rawRegions } = await query.graph({ entity: "region", fields: ["id", "name", "currency_code", "countries.iso_2", "countries.display_name"], pagination: { take: 200, order: { name: "ASC" } } })
  const regions = (rawRegions as { id: string; name?: string; currency_code?: string; countries?: { iso_2?: string; display_name?: string }[] }[])
    .filter((r) => r.currency_code)
    .map((r) => ({
      id: r.id,
      name: r.name ?? r.id,
      currency_code: r.currency_code!.toLowerCase(),
      countries: (r.countries ?? []).filter((c) => c.iso_2).map((c) => ({ iso_2: c.iso_2!.toLowerCase(), name: c.display_name ?? c.iso_2!.toUpperCase() })).sort((a, b) => a.name.localeCompare(b.name)),
    }))
  const { data: rawOptions } = await query.graph({ entity: "shipping_option", fields: OPTION_FIELDS, pagination: { take: 200 } })
  const shipping_options = (rawOptions as Option[])
    .filter((o) => (o.price_type ?? "flat") === "flat" && !isReturnOption(o))
    .map((o) => ({ id: o.id, name: o.name ?? o.id, prices: Object.fromEntries(regions.map((r) => [r.id, shippingPrice(o, r.id, r.currency_code)])) }))
    .filter((o) => Object.values(o.prices).some((p) => p !== null))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { regions, shipping_options }
}

/**
 * The price of a flat shipping option for the region: a price with a rule for this region wins over the plain price of
 * the currency. A calculated option (the carrier prices it at checkout) has no price to take here.
 */
export function shippingPrice(option: Option, regionId: string, currency: string): number | null {
  const prices = (option.prices ?? []).filter((p) => (p.currency_code ?? "").toLowerCase() === currency.toLowerCase())
  const forRegion = prices.find((p) => (p.price_rules ?? []).some((r) => r.attribute === "region_id" && r.value === regionId))
  const plain = prices.find((p) => (p.price_rules ?? []).length === 0)
  const hit = forRegion ?? plain
  return hit ? toNumber(hit.amount) : null
}

/**
 * Everything the order needs that the phone does not send: the region's currency, the store's default sales channel
 * (the app picks the stock location from it), the email of the chosen customer, and the price of the shipping option.
 * All refusals come before anything is written.
 */
export const resolveManualOrderStep = createStep("medusify-resolve-manual-order", async (input: ManualOrder, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: regions } = await query.graph({ entity: "region", fields: ["id", "currency_code"], filters: { id: input.region_id } })
  const region = regions[0] as { currency_code?: string } | undefined
  if (!region?.currency_code) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_region")
  const currency = region.currency_code.toLowerCase()

  let email = input.email
  if (input.customer_id) {
    const { data: customers } = await query.graph({ entity: "customer", fields: ["id", "email"], filters: { id: input.customer_id } })
    const customer = customers[0] as { email?: string | null } | undefined
    if (!customer) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_customer")
    email = email || customer.email || null
  }
  if (!email) throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:email_required")

  const { data: stores } = await query.graph({ entity: "store", fields: ["default_sales_channel_id"], pagination: { take: 1 } })
  const salesChannel = (stores[0] as { default_sales_channel_id?: string | null } | undefined)?.default_sales_channel_id ?? null

  const shipping: Resolved["shipping_methods"] = []
  if (input.shipping_option_id) {
    const { data: options } = await query.graph({
      entity: "shipping_option",
      fields: OPTION_FIELDS,
      filters: { id: input.shipping_option_id },
    })
    const option = options[0] as Option | undefined
    if (!option) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_shipping_option")
    if (isReturnOption(option)) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:shipping_return_option")
    if (option.price_type && option.price_type !== "flat") throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:shipping_calculated")
    const amount = shippingPrice(option, input.region_id, currency)
    if (amount === null) throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "medusify:shipping_no_price")
    shipping.push({ shipping_option_id: option.id, name: option.name ?? "", amount })
  }
  const resolved: Resolved = { currency_code: currency, sales_channel_id: salesChannel, email, shipping_methods: shipping }
  return new StepResponse(resolved)
})

/** The order number the shop gave the converted order, for the answer and the toast. */
export const orderNumberStep = createStep("medusify-manual-order-number", async (input: { order_id: string }, { container }) => {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "order", fields: ["id", "display_id"], filters: { id: input.order_id } })
  return new StepResponse({ display_id: (data[0] as { display_id?: number } | undefined)?.display_id ?? null })
})

/**
 * Last step: the money is already there, so the collection is marked as paid with Medusa's own workflow (it records a
 * captured payment by the signed-in user). It comes last because it is the one thing that is not taken back by the earlier
 * steps' compensation; if it fails, it rolls itself back and the steps before it are compensated.
 */
export const markManualOrderPaidStep = createStep(
  "medusify-manual-order-mark-paid",
  async (input: { paid: boolean; order_id: string; payment_collection_id: string | null; actor_id: string }, { container }) => {
    if (!input.paid || !input.payment_collection_id) return new StepResponse(null)
    await markPaymentCollectionAsPaid(container).run({
      input: { order_id: input.order_id, payment_collection_id: input.payment_collection_id, captured_by: input.actor_id },
    })
    return new StepResponse(null)
  }
)

/**
 * Takes the key before anything is made: a pending record, and the same key goes into the order's metadata. A repeat that
 * finds the record pending (the first try stopped half-way) looks for the order by that key instead of making a second
 * one (lib/manual-order-attempt.ts). A failure later in the workflow takes the record back with the order.
 */
export const beginManualOrderStep = createStep(
  "medusify-begin-manual-order",
  async (input: { key: string; paid: boolean }, { container }) => {
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    const op = await push.createMedusifyOperations({ key: input.key, kind: "manual_order", result: { state: "pending", paid: input.paid } })
    return new StepResponse(op.id, op.id)
  },
  async (id, { container }) => {
    if (!id) return
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    await push.deleteMedusifyOperations([id])
  }
)

/**
 * The order is made and, when asked, marked paid: the key answers with it from now on. A failure here only logs: the
 * order is complete, and a repeat that finds the record pending finds the order complete too.
 */
export const finishManualOrderStep = createStep(
  "medusify-finish-manual-order",
  async (input: { id: string; key: string; paid: boolean; order_id: string; display_id: number | null }, { container }) => {
    const push: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
    try {
      await push.updateMedusifyOperations({ id: input.id, result: { state: "done", paid: input.paid, order_id: input.order_id, display_id: input.display_id } })
    } catch (e) {
      const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as unknown as { error(m: string): void }
      logger.error(`medusify: order ${input.order_id} is made, its key ${input.key} stays pending: ${(e as Error)?.message ?? e}`)
    }
    return new StepResponse(null)
  }
)

/**
 * An order taken by hand (phone, shop counter, mail): Medusa's own draft order, converted at once (that reserves the
 * stock and announces the order like any other), with a payment collection for its total, marked as paid when the
 * money is already there. One workflow: a failure in the middle rolls back what was made before.
 */
export const manualOrderWorkflow = createWorkflow("medusify-manual-order", function (input: ManualOrder) {
  const resolved = resolveManualOrderStep(input)
  const record = beginManualOrderStep(transform({ input }, ({ input }) => ({ key: input.key, paid: input.paid })))
  const orderInput = transform({ input, resolved }, ({ input, resolved }) => ({
    status: "draft",
    is_draft_order: true,
    region_id: input.region_id,
    currency_code: resolved.currency_code,
    email: resolved.email,
    ...(input.customer_id ? { customer_id: input.customer_id } : {}),
    ...(resolved.sales_channel_id ? { sales_channel_id: resolved.sales_channel_id } : {}),
    items: input.items.map((i) => ({ variant_id: i.variant_id, quantity: i.quantity })),
    ...(input.shipping_address ? { shipping_address: input.shipping_address, billing_address: input.shipping_address } : {}),
    shipping_methods: resolved.shipping_methods,
    metadata: { medusify_key: input.key },
  }))
  const draft = createOrderWorkflow.runAsStep({ input: orderInput as never })
  const orderId = transform({ draft }, ({ draft }) => (draft as { id: string }).id)
  convertDraftOrderWorkflow.runAsStep({ input: transform({ orderId }, ({ orderId }) => ({ id: orderId })) })
  const number = orderNumberStep({ order_id: orderId })
  // Medusa's own step: a collection for what is still to pay, none for a free order
  const collections = createOrUpdateOrderPaymentCollectionWorkflow.runAsStep({ input: transform({ orderId }, ({ orderId }) => ({ order_id: orderId })) })
  markManualOrderPaidStep(
    transform({ input, orderId, collections }, ({ input, orderId, collections }) => {
      const list = (Array.isArray(collections) ? collections : collections ? [collections] : []) as { id: string }[]
      return { paid: input.paid, order_id: orderId, payment_collection_id: list[0]?.id ?? null, actor_id: input.actor_id }
    })
  )
  finishManualOrderStep(
    transform({ input, record, orderId, number }, ({ input, record, orderId, number }) => ({ id: record as string, key: input.key, paid: input.paid, order_id: orderId, display_id: number.display_id }))
  )
  return new WorkflowResponse(transform({ orderId, number }, ({ orderId, number }) => ({ order_id: orderId, display_id: number.display_id })))
})
