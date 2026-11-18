import type { MedusifyLocale, PushPayload } from "../modules/medusify-push/types"

export function formatMoney(amount: number, currencyCode: string, locale: MedusifyLocale): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode.toUpperCase(),
    }).format(amount)
  } catch {
    // unknown currency code ⇒ plain number + code instead of failing the push
    return `${amount} ${currencyCode.toUpperCase()}`
  }
}

export function formatItemCount(count: number, locale: MedusifyLocale): string {
  if (locale === "en") {
    return `${count} ${count === 1 ? "item" : "items"}`
  }
  return `${count} Artikel`
}

export function buildOrderPlacedPayload(input: {
  storeLabel: string
  locale: MedusifyLocale
  orderId: string
  displayId: number | string
  amount: number
  currencyCode: string
  itemCount: number
}): PushPayload {
  const { storeLabel, locale, orderId, displayId, amount, currencyCode, itemCount } = input
  const heading = locale === "en" ? "New order" : "Neue Bestellung"
  return {
    title: `${storeLabel}: ${heading} #${displayId}`,
    body: `${formatMoney(amount, currencyCode, locale)} · ${formatItemCount(itemCount, locale)}`,
    data: { url: `/medusify/orders/${orderId}` },
    tag: `order-${orderId}`,
  }
}
