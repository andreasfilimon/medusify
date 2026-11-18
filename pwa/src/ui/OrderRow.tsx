import { Link } from "wouter"
import { useApp } from "../app/context"
import { formatMoney, relativeTime } from "../lib/format"
import { customerName, orderState } from "../lib/orders"
import type { DashboardOrder, Order, Shop } from "../lib/types"
import { Icon } from "./Icon"
import { Monogram, StateChip } from "./kit"

type RowOrder = Pick<Order, "id" | "display_id" | "created_at" | "currency_code" | "total" | "status" | "payment_status" | "fulfillment_status"> &
  Partial<Pick<Order, "email" | "shipping_address">> &
  Partial<Pick<DashboardOrder, "item_count">>

/** One order in a list. With "Alle Shops" the row carries the shop's monogram and name in the text. */
export function OrderRow({ shop, order, showShop }: { shop: Shop; order: RowOrder; showShop: boolean }) {
  const { t, lang, now } = useApp()
  const state = orderState(order)
  const named = !!(order.shipping_address || order.email)
  const who = named ? customerName(order) : t("detail.title", { n: `#${order.display_id}` })
  const when = relativeTime(order.created_at, now, lang)
  const amount = formatMoney(order.total, order.currency_code, lang)
  const sub = [named ? `#${order.display_id}` : null, showShop ? shop.name : null, when].filter(Boolean).join(" · ")
  return (
    <Link
      className="row"
      href={`/orders/${encodeURIComponent(order.id)}?shop=${encodeURIComponent(shop.id)}`}
      aria-label={t("orders.row", { n: order.display_id, customer: who, shop: shop.name, amount, state: t(`state.${state}`), when })}
    >
      {showShop ? (
        <Monogram shop={shop} />
      ) : (
        <span className="thumb" aria-hidden="true">
          <Icon name="receipt" size="sm" />
        </span>
      )}
      <span className="row-main">
        <span className="row-title">{who}</span>
        <span className="row-sub">{sub}</span>
      </span>
      <span className="row-end">
        <span className="amount">{amount}</span>
        <StateChip state={state} />
      </span>
    </Link>
  )
}
