import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createOrderPaymentCollectionWorkflow,
  createOrderWorkflow,
  createRegionsWorkflow,
  getOrdersListWorkflow,
  markPaymentCollectionAsPaid,
  refundPaymentWorkflow,
} from "@medusajs/medusa/core-flows"

export async function createRegion(container: MedusaContainer, currency = "eur", country = "at") {
  const { result } = await createRegionsWorkflow(container).run({
    input: { regions: [{ name: `R-${currency}`, currency_code: currency, countries: [country] }] },
  })
  return result[0]
}

type OrderOpts = {
  /** Payment authorized but not captured yet (card holds, "capture manually"). */
  authorized?: boolean
  regionId: string
  currency?: string
  country?: string
  items?: { title: string; quantity: number; unit_price: number; requires_shipping?: boolean }[]
  /** The shipping option of the shipping method (needed to create fulfillments). */
  shippingOptionId?: string
  /** A digital order: no shipping method at all. */
  noShippingMethod?: boolean
  shipping?: number
  status?: string
  paid?: boolean
  /**
   * The (demo) customer the order belongs to. For a guest (no account) Medusa keeps the customer only when the order
   * email is the customer's (core-flows find-or-create-customer), so pass `email` too.
   */
  customerId?: string
  email?: string
}

/** Demo order only: invented buyer, no real customer data. */
export async function createDemoOrder(container: MedusaContainer, o: OrderOpts) {
  const currency = o.currency ?? "eur"
  const items = o.items ?? [{ title: "Widget", quantity: 2, unit_price: 19.99 }]
  const shipping = o.noShippingMethod ? 0 : (o.shipping ?? 5)
  const { result } = await createOrderWorkflow(container).run({
    input: {
      region_id: o.regionId,
      currency_code: currency,
      email: o.email ?? "buyer@example.invalid",
      status: o.status,
      ...(o.customerId ? { customer_id: o.customerId } : {}),
      items,
      shipping_methods: o.noShippingMethod ? [] : [{ name: "Standard", amount: shipping, ...(o.shippingOptionId ? { shipping_option_id: o.shippingOptionId } : {}) }],
      shipping_address: {
        first_name: "Demo",
        last_name: "Buyer",
        address_1: "Teststrasse 1",
        city: "Wien",
        country_code: o.country ?? "at",
        postal_code: "1010",
      },
    } as any,
  })
  if (o.authorized) {
    const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0) + shipping
    const { result: pc } = await createOrderPaymentCollectionWorkflow(container).run({
      input: { order_id: result.id, amount: Math.round(total * 100) / 100 },
    })
    const payments = container.resolve(Modules.PAYMENT)
    const session = await payments.createPaymentSession((pc as any)[0].id, {
      provider_id: "pp_system_default",
      currency_code: currency,
      amount: Math.round(total * 100) / 100,
      data: {},
    })
    await payments.authorizePaymentSession(session.id, {})
  }
  if (o.paid) {
    const total = items.reduce((s, i) => s + i.quantity * i.unit_price, 0) + shipping
    const { result: pc } = await createOrderPaymentCollectionWorkflow(container).run({
      input: { order_id: result.id, amount: Math.round(total * 100) / 100 },
    })
    await markPaymentCollectionAsPaid(container).run({
      input: { order_id: result.id, payment_collection_id: (pc as any)[0].id, captured_by: "usr_demo" },
    })
  }
  return result
}

/** Refunds `amount` of the captured payment of a paid demo order (through Medusa's own refund workflow). */
export async function refundDemoOrder(container: MedusaContainer, orderId: string, amount: number) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({ entity: "order", fields: ["id", "payment_collections.payments.id"], filters: { id: orderId } })
  const paymentId = order.payment_collections?.[0]?.payments?.[0]?.id
  if (!paymentId) throw new Error(`order ${orderId} has no payment to refund`)
  await refundPaymentWorkflow(container).run({ input: { payment_id: paymentId, amount } })
}

/** The statuses exactly as Medusa's admin order list computes them. */
export async function listedStatuses(container: MedusaContainer, orderId: string) {
  const { result } = await getOrdersListWorkflow(container).run({
    input: { fields: ["id", "summary.*"], variables: { filters: { id: orderId }, skip: 0, take: 1 } },
  })
  const rows = Array.isArray(result) ? result : (result as any).rows
  return rows[0] as Record<string, any>
}

/**
 * Marks items of a demo order as fulfilled, the way a fulfillment would (order module's own register call). Medusa only
 * accepts a return for goods that were fulfilled: the limit is `fulfilled_quantity` minus what is already on a return.
 */
export async function fulfillDemoItems(container: MedusaContainer, orderId: string, items: { id: string; quantity: number }[]) {
  await container.resolve(Modules.ORDER).registerFulfillment({ order_id: orderId, items } as any)
}
