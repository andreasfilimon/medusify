import { formatMoney, type Lang } from "./format"

/** A discount code as Medusa's /admin/promotions answers it (the fields the app asks for). */
export type Discount = {
  id: string
  code: string
  status: "draft" | "active" | "inactive"
  is_automatic: boolean
  /** How often the code may be used in all; null is no limit. */
  limit: number | null
  used: number
  created_at: string
  application_method: { type: "percentage" | "fixed"; value: number; currency_code: string | null; target_type: string } | null
}

/** What the code takes off: "20 %" or "5,00 €". A code whose method could not be read shows nothing. */
export function discountValue(d: Pick<Discount, "application_method">, lang: Lang): string {
  const m = d.application_method
  if (!m) return ""
  if (m.type === "percentage") return `${new Intl.NumberFormat(lang === "de" ? "de-AT" : "en-GB", { maximumFractionDigits: 2 }).format(m.value)} %`
  return m.currency_code ? formatMoney(m.value, m.currency_code, lang) : String(m.value)
}

/** A code as people type it on a checkout: letters, digits, dash and underscore, upper case. */
export const CODE_MIN = 3
export const CODE_MAX = 32

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "")
}

export type CodeCheck = { ok: true; code: string } | { ok: false; reason: "short" | "long" | "chars" }

export function checkCode(raw: string): CodeCheck {
  const code = normalizeCode(raw)
  if (code.length < CODE_MIN) return { ok: false, reason: "short" }
  if (code.length > CODE_MAX) return { ok: false, reason: "long" }
  if (!/^[A-Z0-9_-]+$/.test(code)) return { ok: false, reason: "chars" }
  return { ok: true, code }
}

export type PercentCheck = { ok: true; value: number } | { ok: false; reason: "empty" | "invalid" | "range" }

/** 1 to 100 per cent, at most two decimals. */
export function checkPercent(raw: string): PercentCheck {
  const text = raw.replace(/[\s %]/g, "")
  if (text === "") return { ok: false, reason: "empty" }
  if (!/^\d+([.,]\d{1,2})?$/.test(text)) return { ok: false, reason: "invalid" }
  const value = Number(text.replace(",", "."))
  if (value <= 0 || value > 100) return { ok: false, reason: "range" }
  return { ok: true, value }
}

export type LimitCheck = { ok: true; value: number | null } | { ok: false }

/** Empty is "no limit"; otherwise a whole number from 1 on. */
export function checkLimit(raw: string): LimitCheck {
  const text = raw.trim()
  if (text === "") return { ok: true, value: null }
  if (!/^\d{1,9}$/.test(text) || Number(text) < 1) return { ok: false }
  return { ok: true, value: Number(text) }
}

/**
 * The same code as the create asked for: a create whose answer was lost, found again. Everything the create sets must match,
 * status (active) and limit too: a paused code or one with another limit is not what the merchant just made.
 */
export function sameDiscount(d: Discount, input: { code: string; type: "percentage" | "fixed"; value: number; currency_code: string | null; limit: number | null }): boolean {
  const m = d.application_method
  return (
    !!m &&
    d.code === input.code &&
    d.status === "active" &&
    (d.limit ?? null) === input.limit &&
    m.type === input.type &&
    Number(m.value) === input.value &&
    (input.type === "percentage" || (m.currency_code ?? "").toLowerCase() === (input.currency_code ?? "").toLowerCase())
  )
}
