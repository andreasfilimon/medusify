export type Lang = "de" | "en"

export function localeOf(lang: Lang): string {
  return lang === "de" ? "de-AT" : "en-GB"
}

/** Amounts arrive in major units (measured on Medusa 2.22: 43.9 means 43,90). Currency sign stays attached to the number. */
export function formatMoney(amount: number, currency: string, lang: Lang): string {
  try {
    return new Intl.NumberFormat(localeOf(lang), { style: "currency", currency: currency.toUpperCase() }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency.toUpperCase()}`
  }
}

export function currencyName(code: string, lang: Lang): string {
  try {
    return new Intl.DisplayNames([localeOf(lang)], { type: "currency" }).of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const MIN = 60_000
const HOUR = 60 * MIN

/** "vor 4 Min", "vor 3 Std", otherwise a short date. Callers pass `now` so tests stay deterministic. */
export function relativeTime(iso: string, now: number, lang: Lang): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  if (diff < MIN) return lang === "de" ? "gerade eben" : "just now"
  if (diff < HOUR) {
    const m = Math.floor(diff / MIN)
    return lang === "de" ? `vor ${m} Min` : `${m} min ago`
  }
  if (diff < 24 * HOUR) {
    const h = Math.floor(diff / HOUR)
    return lang === "de" ? `vor ${h} Std` : `${h} h ago`
  }
  return new Intl.DateTimeFormat(localeOf(lang), { day: "numeric", month: "short" }).format(new Date(iso))
}

export function timeOfDay(date: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(localeOf(lang), { hour: "2-digit", minute: "2-digit" }).format(date)
}

export function dateTime(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(localeOf(lang), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

export function monthName(date: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(localeOf(lang), { month: "long" }).format(date)
}

export type DayKey = "today" | "yesterday" | string

/** Group label for the order list: today, yesterday, otherwise the date. */
export function dayGroup(iso: string, now: number, lang: Lang): { key: string; label: string } {
  const d = new Date(iso)
  const n = new Date(now)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((start(n) - start(d)) / 86_400_000)
  if (diffDays <= 0) return { key: "today", label: lang === "de" ? "Heute" : "Today" }
  if (diffDays === 1) return { key: "yesterday", label: lang === "de" ? "Gestern" : "Yesterday" }
  const label = new Intl.DateTimeFormat(localeOf(lang), { weekday: "long", day: "numeric", month: "long" }).format(d)
  return { key: start(d).toString(), label }
}

/** Removes whitespace and the check prefix some carriers print in front of the number ("]C0", "]d2"). */
export function cleanTrackingNumber(raw: string): string {
  return raw.replace(/^\][A-Za-z][0-9A-Za-z]/, "").replace(/\s+/g, "").trim()
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}
