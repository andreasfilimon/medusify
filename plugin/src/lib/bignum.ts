import { MathBN } from "@medusajs/framework/utils"

export type Amount = number | string | { value?: string | number } | null | undefined

/** Medusa returns money as number, numeric string or BigNumber-like `{ value }`. */
export function toBN(value: Amount) {
  if (value && typeof value === "object") {
    const raw = (value as { value?: string | number }).value
    // a raw amount `{ value, precision }`; otherwise a BigNumber instance (no `value` field), which MathBN reads itself
    return raw !== undefined && raw !== null ? MathBN.convert(raw) : MathBN.convert(value as never)
  }
  return MathBN.convert((value as number | string | null | undefined) ?? 0)
}

export function toNumber(value: Amount): number {
  return toBN(value).toNumber()
}
