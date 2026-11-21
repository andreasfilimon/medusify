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
  /** Orders still to ship; null when it could not be counted (the app then keeps its number). */
  toShip?: number | null
}): PushPayload {
  const { storeLabel, locale, orderId, displayId, amount, currencyCode, itemCount, toShip } = input
  const heading = locale === "en" ? "New order" : "Neue Bestellung"
  return {
    title: `${storeLabel}: ${heading} #${displayId}`,
    body: `${formatMoney(amount, currencyCode, locale)} · ${formatItemCount(itemCount, locale)}`,
    data: pushData(orderId, "order_placed", storeLabel, toShip),
    tag: `order-${orderId}`,
  }
}

function pushData(orderId: string, kind: string, storeLabel: string, toShip: number | null | undefined) {
  return {
    url: `/medusify/orders/${orderId}`,
    kind,
    shop: storeLabel,
    ...(typeof toShip === "number" ? { badge: toShip } : {}),
  }
}

export function buildOrderCanceledPayload(input: {
  storeLabel: string
  locale: MedusifyLocale
  orderId: string
  displayId: number | string
  amount: number
  currencyCode: string
  toShip?: number | null
}): PushPayload {
  const { storeLabel, locale, orderId, displayId, amount, currencyCode, toShip } = input
  const heading = locale === "en" ? "Order canceled" : "Bestellung storniert"
  return {
    title: `${storeLabel}: ${heading} #${displayId}`,
    body: formatMoney(amount, currencyCode, locale),
    data: pushData(orderId, "canceled", storeLabel, toShip),
    tag: `order-${orderId}-canceled`,
  }
}

export function buildReturnRequestedPayload(input: {
  storeLabel: string
  locale: MedusifyLocale
  orderId: string
  returnId: string
  displayId: number | string
  itemCount: number
  toShip?: number | null
}): PushPayload {
  const { storeLabel, locale, orderId, returnId, displayId, itemCount, toShip } = input
  const heading = locale === "en" ? "Return requested" : "Retoure angefragt"
  return {
    title: `${storeLabel}: ${heading} #${displayId}`,
    body: formatItemCount(itemCount, locale),
    data: pushData(orderId, "return_requested", storeLabel, toShip),
    tag: `return-${returnId}`,
  }
}

export function buildLowStockPayload(input: {
  storeLabel: string
  locale: MedusifyLocale
  inventoryItemId: string
  productId: string | null
  /** Product title, with the variant title when the product has more than the default variant. */
  name: string
  /** Units that can still be sold over all locations; 0 or less is sold out. */
  available: number
}): PushPayload {
  const { storeLabel, locale, inventoryItemId, productId, name, available } = input
  const soldOut = available <= 0
  const heading = soldOut ? (locale === "en" ? "Sold out" : "Ausverkauft") : locale === "en" ? "Low stock" : "Bestand niedrig"
  const rest = soldOut ? "" : locale === "en" ? ` · ${available} left` : ` · noch ${available}`
  return {
    title: `${storeLabel}: ${heading}`,
    body: `${name}${rest}`,
    // No `badge`: the number on the icon counts orders to ship, a stock message must not change it.
    data: { url: productId ? `/medusify/products/${productId}` : "/medusify/products", kind: "low_stock", shop: storeLabel },
    tag: `low-stock-${inventoryItemId}`,
  }
}

export function buildDailySummaryPayload(input: {
  /** The subscription (one device, one shop): today's summary replaces yesterday's, never another shop's. */
  subscriptionId: string
  storeLabel: string
  locale: MedusifyLocale
  orders: number
  revenue: { currency_code: string; amount: number }[]
  toShip: number
}): PushPayload {
  const { subscriptionId, storeLabel, locale, orders, revenue, toShip } = input
  const heading = locale === "en" ? "Today" : "Heute"
  const count = locale === "en" ? `${orders} ${orders === 1 ? "order" : "orders"}` : `${orders} ${orders === 1 ? "Bestellung" : "Bestellungen"}`
  // one amount per currency, never added up
  const money = revenue.map((r) => formatMoney(r.amount, r.currency_code, locale))
  const ship = toShip > 0 ? [locale === "en" ? `${toShip} to ship` : `${toShip} zu versenden`] : []
  return {
    title: `${storeLabel}: ${heading}`,
    body: [count, ...money, ...ship].join(" · "),
    data: { url: "/medusify/", kind: "daily_summary", shop: storeLabel, badge: toShip },
    tag: `daily-summary-${subscriptionId}`,
  }
}
