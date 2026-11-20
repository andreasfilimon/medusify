import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { type PriceView, toPriceViews } from "./catalog"
import { type Amount, toNumber } from "./bignum"

type Locking = { execute<R>(keys: string | string[], job: () => Promise<R>, args?: { timeout?: number; expire?: number }): Promise<R> }

export type ExistingPrice = { id: string; currency_code: string; amount: number; min_quantity: number | null; max_quantity: number | null; base: boolean }
export type PriceInput = { id?: string; currency_code: string; amount: number; min_quantity?: number | null; max_quantity?: number | null }

/** How many decimals the currency has (2 for euro, 0 for yen, 3 for dinar). */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** An amount in the main unit that the currency can hold: 19.99 euro yes, 19.999 euro no, 19.5 yen no. */
export function amountFitsCurrency(currency: string, amount: number): boolean {
  const digits = currencyDigits(currency)
  return Number.isFinite(amount) && Math.abs(Number(amount.toFixed(digits)) - amount) < 1e-9
}

/**
 * The full price list of the variant with the base price of one currency changed or added.
 *
 * Why the full list: Medusa's price update replaces the prices of the price set with the list it is given, and deletes
 * every price that is not in it (`updatePriceSets_`, `pricesToDelete`). Sending only the changed price would erase the
 * variant's other currencies, region prices and quantity tiers. Every other price goes back with its id and its values;
 * rules stay as they are because they are not part of what is sent.
 */
export function buildPriceList(existing: ExistingPrice[], currency: string, amount: number): { prices: PriceInput[]; created: boolean } {
  const code = currency.toLowerCase()
  const target = existing.find((p) => p.base && p.currency_code === code)
  const prices: PriceInput[] = existing.map((p) => ({
    id: p.id,
    currency_code: p.currency_code,
    amount: p === target ? amount : p.amount,
    ...(p.min_quantity !== null ? { min_quantity: p.min_quantity } : {}),
    ...(p.max_quantity !== null ? { max_quantity: p.max_quantity } : {}),
  }))
  if (!target) prices.push({ currency_code: code, amount })
  return { prices, created: !target }
}

type RawVariant = { id: string; price_set?: { prices?: ({ id: string; amount?: Amount; currency_code?: string | null; min_quantity?: Amount; max_quantity?: Amount; rules_count?: number | null; price_list_id?: string | null } | null)[] | null } | null }

/**
 * Sets the base price of one currency of a variant, in the main unit of the currency. Read and write run under a lock
 * per variant, so two phones changing two currencies at the same time do not drop each other's change.
 */
export async function setBasePrice(container: MedusaContainer, variantId: string, currency: string, amount: number): Promise<PriceView[]> {
  if (!amountFitsCurrency(currency, amount)) throw new MedusaError(MedusaError.Types.INVALID_DATA, "medusify:amount_decimals")
  const locking = container.resolve(Modules.LOCKING) as unknown as Locking
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fields = ["id", "price_set.prices.id", "price_set.prices.amount", "price_set.prices.currency_code", "price_set.prices.min_quantity", "price_set.prices.max_quantity", "price_set.prices.rules_count", "price_set.prices.price_list_id"]
  const read = async (): Promise<RawVariant> => {
    const { data } = await query.graph({ entity: "variant", fields, filters: { id: variantId } })
    if (data.length === 0) throw new MedusaError(MedusaError.Types.NOT_FOUND, "medusify:no_variant")
    return data[0] as RawVariant
  }
  await locking.execute(
    [`medusify-price:${variantId}`],
    async () => {
      const variant = await read()
      const views = toPriceViews(variant.price_set?.prices)
      const raw = new Map((variant.price_set?.prices ?? []).filter(Boolean).map((p) => [p!.id, p!]))
      const existing: ExistingPrice[] = views.map((v) => {
        const r = raw.get(v.id)!
        const min = r.min_quantity === null || r.min_quantity === undefined ? null : toNumber(r.min_quantity)
        const max = r.max_quantity === null || r.max_quantity === undefined ? null : toNumber(r.max_quantity)
        return { id: v.id, currency_code: v.currency_code, amount: v.amount, min_quantity: min, max_quantity: max, base: v.base }
      })
      const { prices } = buildPriceList(existing, currency, amount)
      await updateProductVariantsWorkflow(container).run({ input: { product_variants: [{ id: variantId, prices }] } as never })
    },
    { timeout: 30, expire: 60 }
  )
  return toPriceViews((await read()).price_set?.prices)
}
