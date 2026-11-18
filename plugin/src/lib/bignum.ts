import { MathBN } from "@medusajs/framework/utils"

type Amount = number | string | { value?: string | number } | null | undefined

/** Medusa returns money as number, numeric string or BigNumber-like `{ value }`. */
export function toBN(value: Amount) {
  if (value && typeof value === "object") {
    return MathBN.convert((value as { value?: string | number }).value ?? 0)
  }
  return MathBN.convert((value as number | string | null | undefined) ?? 0)
}

export function toNumber(value: Amount): number {
  return toBN(value).toNumber()
}
