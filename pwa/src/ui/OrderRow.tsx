import { useQuery } from "@tanstack/react-query"
import { Link, useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { formatMoney, relativeTime } from "../lib/format"
import { tapOrder } from "../lib/transition"
import { customerName, orderState } from "../lib/orders"
import type { DashboardOrder, Order, Shop } from "../lib/types"
import { Icon } from "./Icon"
import { Digits, Monogram, StateChip } from "./kit"
import { SwipeRow } from "./SwipeRow"

type RowOrder = Pick<Order, "id" | "display_id" | "created_at" | "currency_code" | "total" | "status" | "payment_status" | "fulfillment_status"> &
  Partial<Pick<Order, "email" | "shipping_address">> &
  Partial<Pick<DashboardOrder, "item_count">>

/** One order in a list. With "Alle Shops" the row carries the shop's monogram and name in the text. */
export function OrderRow({ shop, order, showShop }: { shop: Shop; order: RowOrder; showShop: boolean }) {
  const { t, lang, now } = useApp()
  const state = orderState(order)
  const [, navigate] = useLocation()
  // The role decides whether "paid" is offered; the query is the one the detail page uses, so it is asked once per shop.
  const perms = useQuery({ queryKey: ["permissions", shop.id], queryFn: () => api.getPermissions(shop), staleTime: 5 * 60_000, retry: false, enabled: order.payment_status === "not_paid" && state === "payment_pending" })
  const named = !!(order.shipping_address || order.email)
  const who = named ? customerName(order) : t("detail.title", { n: `#${order.display_id}` })
  const when = relativeTime(order.created_at, now, lang)
  const amount = formatMoney(order.total, order.currency_code, lang)
  const sub = [named ? `#${order.display_id}` : null, showShop ? shop.name : null, when].filter(Boolean).join(" · ")
  const href = `/orders/${encodeURIComponent(order.id)}?shop=${encodeURIComponent(shop.id)}`
  // Only what the state of the order allows; the detail page checks again before it opens the confirmation.
  const intent: "ship" | "paid" | null =
    state === "to_ship" || state === "partly" ? "ship" : state === "payment_pending" && order.payment_status === "not_paid" && perms.data?.mark_paid ? "paid" : null
  const open = (what: "ship" | "paid") => {
    tapOrder(order.id, order.display_id, null)
    navigate(`${href}&do=${what}`)
  }
  const action = intent ? { label: t(intent === "ship" ? "orders.shipAction" : "orders.paidAction"), icon: <Icon name={intent === "ship" ? "package" : "check-circle"} />, onRun: () => open(intent) } : null
  return (
    <SwipeRow action={action}>
    <Link
      className="row"
      draggable={false}
      data-order={order.id}
      onClickCapture={(e) => tapOrder(order.id, order.display_id, e.currentTarget.querySelector<HTMLElement>(".row-title"))}
      href={href}
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
        <Digits className="amount" text={amount} />
        <StateChip state={state} />
      </span>
    </Link>
    </SwipeRow>
  )
}
