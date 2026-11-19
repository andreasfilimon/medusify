/** How many decimals the currency has (euro 2, yen 0, dinar 3). Read from the platform, 2 when it does not know the code. */
export function fractionDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/** Whole minor units (cents), so sums and comparisons never meet floating point. */
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** fractionDigits(currency))
}

export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** fractionDigits(currency)
}

export type AmountCheck =
  | { ok: true; value: number }
  | { ok: false; reason: "empty" | "invalid" | "zero" | "decimals" | "above" }

/**
 * Reads what the user typed into an amount field and checks it against the most that may be entered.
 * One decimal separator (comma or point), no thousands separators. Nothing above `max` passes: this check runs before
 * any request leaves the app, so the shop is never asked for a refund it would have to refuse.
 */
export function checkAmount(raw: string, currency: string, max: number): AmountCheck {
  const text = raw.replace(/[\s ]/g, "")
  if (text === "") return { ok: false, reason: "empty" }
  if (!/^\d+([.,]\d+)?$/.test(text)) return { ok: false, reason: "invalid" }
  const [, decimals = ""] = text.split(/[.,]/)
  if (decimals.length > fractionDigits(currency)) return { ok: false, reason: "decimals" }
  const value = Number(text.replace(",", "."))
  const minor = toMinor(value, currency)
  if (minor <= 0) return { ok: false, reason: "zero" }
  if (minor > toMinor(max, currency)) return { ok: false, reason: "above" }
  return { ok: true, value: fromMinor(minor, currency) }
}

/** The number as the field shows it: no currency sign, the locale's decimal separator, always the full decimals. */
export function amountFieldText(amount: number, currency: string, lang: "de" | "en"): string {
  const d = fractionDigits(currency)
  return new Intl.NumberFormat(lang === "de" ? "de-AT" : "en-GB", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false }).format(amount)
}
