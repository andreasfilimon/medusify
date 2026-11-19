import { useQuery } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useLocation, useSearch } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { ApiError } from "../lib/api"
import { reread } from "../lib/attempt"
import { dateTime, formatMoney } from "../lib/format"
import { contactLinks } from "../lib/actions"
import { tappedOrder } from "../lib/transition"
import { goBack } from "../lib/nav"
import { customerName, goodsTotal, orderState } from "../lib/orders"
import type { Order, Shop } from "../lib/types"
import { Icon } from "../ui/Icon"
import { Empty, ErrorState, Monogram, Section, Skeleton, StateChip } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { Scroll } from "../ui/Scroll"
import { Sheet } from "../ui/Sheet"
import { useToast } from "../ui/Toast"
import { OrderActions } from "../ui/OrderActions"
import { ShipForm } from "../ui/ShipForm"

type Located = { shop: Shop; order: Order }

/** With ?shop= the shop is known. A push link has no shop: every signed-in shop is asked, the first hit wins. */
async function locate(shops: Shop[], shopId: string | null, id: string): Promise<Located> {
  const candidates = shopId ? shops.filter((s) => s.id === shopId) : shops
  if (candidates.length === 0) throw new ApiError("notfound", 404)
  const results = await Promise.allSettled(candidates.map(async (shop) => ({ shop, order: await api.getOrder(shop, id) })))
  const hit = results.find((r): r is PromiseFulfilledResult<Located> => r.status === "fulfilled")
  if (hit) return hit.value
  const err = results.map((r) => (r.status === "rejected" ? r.reason : null)).find((e) => e && !(e instanceof ApiError && e.kind === "notfound"))
  throw err ?? new ApiError("notfound", 404)
}

export function OrderDetail({ id }: { id: string }) {
  const { t, lang, shops, online } = useApp()
  const [, navigate] = useLocation()
  const params = new URLSearchParams(useSearch())
  const shopId = params.get("shop")
  // A swipe action in the list lands here with ?do=…; it opens the matching confirmation once, then the address is clean again.
  const intent = useRef(params.get("do"))
  const intentDone = useRef(false)
  const toast = useToast()
  const [shipping, setShipping] = useState(false)
  const [shipBusy, setShipBusy] = useState(false)
  const authed = shops.filter((s) => s.home || s.token)
  const query = useQuery({ queryKey: ["order", shopId ?? "any", id], queryFn: () => locate(authed, shopId, id), retry: false })
  useEffect(() => {
    if (intentDone.current || !intent.current || !query.data) return
    intentDone.current = true
    const st = orderState(query.data.order)
    if (intent.current === "ship" && (st === "to_ship" || st === "partly")) setShipping(true)
    navigate(`/orders/${encodeURIComponent(id)}${shopId ? `?shop=${encodeURIComponent(shopId)}` : ""}`, { replace: true })
  }, [query.data, id, shopId, navigate])
  // A read that works after the screen had failed also settles an action whose answer got lost (its lock waits for exactly that).
  const retry = async () => {
    const r = await query.refetch()
    if (r.isSuccess) reread(`${r.data.shop.id}|${r.data.order.id}`)
  }
  // The title is known from the row that was tapped, so the shared element has a partner while the order loads.
  const peek = tappedOrder(id)
  const peekTitle = peek ? t("detail.title", { n: `#${peek.n}` }) : undefined
  const back = { label: t("tab.orders"), onClick: () => goBack(navigate, "/orders") }

  if (query.isPending) {
    return (
      <div className="screen" data-detail="">
        <NavBar back={back} title={peekTitle} />
        <Scroll>
          {peekTitle ? <div className="largetitle detail-title"><h1>{peekTitle}</h1></div> : null}
          <Skeleton rows={4} />
        </Scroll>
      </div>
    )
  }
  if (query.isError) {
    const gone = query.error instanceof ApiError && query.error.kind === "notfound"
    return (
      <div className="screen">
        <NavBar back={back} />
        <Scroll>{gone ? <Empty icon="receipt" title={t("detail.gone")} /> : <ErrorState text={t("detail.error")} onRetry={() => void retry()} />}</Scroll>
      </div>
    )
  }

  const { shop, order } = query.data
  const state = orderState(order)
  const money = (n: number | undefined) => formatMoney(n ?? 0, order.currency_code, lang)
  const items = order.items ?? []
  const totalQty = items.reduce((s, i) => s + i.quantity, 0)
  // Shipped or, for goods without shipping (a voucher), delivered.
  const shippedQty = items.reduce((s, i) => s + Math.max(Number(i.detail?.shipped_quantity ?? 0), Number(i.detail?.delivered_quantity ?? 0)), 0)
  const a = order.shipping_address
  const contact = contactLinks(order)
  const shipments = (order.fulfillments ?? []).filter((f) => f.shipped_at && !f.canceled_at)
  const payment = order.payment_collections?.[0]?.payments?.[0]
  const events = [
    ...(state === "to_ship" || state === "partly" ? [{ key: "pending", label: t("detail.ev.pending"), when: null as string | null, now: true }] : []),
    ...shipments.map((f) => ({ key: `s-${f.id}`, label: t("detail.ev.shipped"), when: f.shipped_at ?? null, now: false })),
    ...(payment?.captured_at ? [{ key: "paid", label: t("detail.ev.paid"), when: payment.captured_at, now: false }] : []),
    ...(state === "canceled" ? [{ key: "canceled", label: t("detail.ev.canceled"), when: null, now: false }] : []),
    { key: "placed", label: t("detail.ev.placed"), when: order.created_at, now: false },
  ]

  return (
    <div className="screen" data-detail="">
      <NavBar back={back} title={t("detail.title", { n: `#${order.display_id}` })} />
      <Scroll>
        <div className="largetitle detail-title">
          <h1>{t("detail.title", { n: `#${order.display_id}` })}</h1>
          <p className="detail-sub">
            <Monogram shop={shop} small />
            {shop.name} · {dateTime(order.created_at, lang)}
          </p>
          <StateChip state={state} />
        </div>

        <Section id="items" title={t("detail.items")}>
          <div className="group">
            {items.map((i) => (
              <div className="row" key={i.id}>
                {i.thumbnail ? <img className="thumb lg" src={i.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="thumb lg" aria-hidden="true"><Icon name="package" size="sm" /></span>}
                <span className="row-main">
                  <span className="row-title reg wrap">{i.product_title || i.title}</span>
                  <span className="row-sub">{[i.variant_title, t("detail.qty", { n: i.quantity })].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="amount">{money(i.total)}</span>
              </div>
            ))}
          </div>
          <dl className="group totals">
            <div className="kv"><dt>{t("detail.subtotal")}</dt><dd>{money(goodsTotal(order))}</dd></div>
            <div className="kv"><dt>{t("detail.shipping")}</dt><dd>{money(order.shipping_total)}</dd></div>
            <div className="kv total"><dt>{t("detail.total")}</dt><dd>{money(order.total)}</dd></div>
            {order.tax_total ? <div className="kv"><dt>{t("detail.tax")}</dt><dd>{money(order.tax_total)}</dd></div> : null}
          </dl>
        </Section>

        <Section id="customer" title={t("detail.customer")}>
          <div className="group plain">
            <div className="row single block">
              <span className="row-main">
                <span className="row-title reg wrap">{customerName(order)}</span>
                {a ? (
                  <span className="row-sub address">
                    {[a.company, a.address_1, a.address_2, [a.postal_code, a.city].filter(Boolean).join(" "), a.country_code?.toUpperCase()].filter(Boolean).join("\n")}
                  </span>
                ) : null}
              </span>
            </div>
            {order.shipping_methods?.[0]?.name ? <div className="kv"><dt>{t("detail.shipping")}</dt><dd>{order.shipping_methods[0].name}</dd></div> : null}
            {contact.phone ? <a className="row" href={contact.phone.href}><span className="row-main"><span className="row-title reg tint">{contact.phone.text}</span><span className="row-sub">{t("detail.call")}</span></span></a> : null}
            {contact.email ? <a className="row" href={contact.email.href}><span className="row-main"><span className="row-title reg tint wrap">{contact.email.text}</span><span className="row-sub">{t("detail.mail")}</span></span></a> : null}
          </div>
        </Section>

        <OrderActions shop={shop} order={order} intent={intent.current === "paid" ? "paid" : null} />

        <Section id="payment" title={t("detail.payment")}>
          <dl className="group">
            <div className="kv"><dt>{t("detail.paymentStatus")}</dt><dd>{t(`payment.${order.payment_status}` as never) === `payment.${order.payment_status}` ? order.payment_status : t(`payment.${order.payment_status}` as never)}</dd></div>
            {payment?.provider_id ? <div className="kv"><dt>{t("detail.paymentMethod")}</dt><dd>{payment.provider_id.replace(/^pp_/, "").replace(/_/g, " ")}</dd></div> : null}
          </dl>
        </Section>

        {shipments.length > 0 ? (
          <Section id="shipments" title={t("detail.shipments")}>
            <div className="group">
              {shipments.flatMap((f) => (f.labels?.length ? f.labels : [{ tracking_number: null, tracking_url: null }]).map((l, n) => (
                <div className="row single" key={`${f.id}-${n}`}>
                  <span className="row-main"><span className="row-title reg num">{l.tracking_number || "-"}</span></span>
                  {l.tracking_number ? (
                    <button className="navbtn" onClick={() => void navigator.clipboard?.writeText(l.tracking_number!).then(() => toast.show(t("common.copied")))}>{t("common.copy")}</button>
                  ) : null}
                </div>
              )))}
            </div>
          </Section>
        ) : null}

        <Section id="history" title={t("detail.history")}>
          <div className="group timeline">
            {events.map((e) => (
              <div className="row single" key={e.key}>
                <span className={`dot ${e.now ? "now" : "done"}`}><Icon name={e.now ? "clock" : "check-circle"} size="sm" /></span>
                <span className="row-main"><span className="row-title reg">{e.label}</span></span>
                {e.when ? <time dateTime={e.when}>{dateTime(e.when, lang)}</time> : null}
              </div>
            ))}
          </div>
        </Section>
      </Scroll>

      {state === "to_ship" || state === "partly" || state === "payment_pending" ? (
        <div className="dock">
          <div className="dock-col">
            {state === "partly" ? <p className="dock-note">{t("detail.partly", { done: shippedQty, all: totalQty })}</p> : null}
            {state === "payment_pending" ? <p className="dock-note">{t("detail.payWait")}</p> : null}
            <button className="btn primary" disabled={state === "payment_pending" || !online} onClick={() => setShipping(true)}>
              <Icon name="package" size="sm" />
              {state === "partly" ? t("detail.shipRest") : t("detail.ship")}
            </button>
          </div>
        </div>
      ) : null}

      {shipping ? (
        <Sheet title={t("ship.title")} onClose={() => setShipping(false)} locked={shipBusy}>
          <ShipForm shop={shop} order={order} onDone={() => setShipping(false)} onBusyChange={setShipBusy} />
        </Sheet>
      ) : null}
    </div>
  )
}
