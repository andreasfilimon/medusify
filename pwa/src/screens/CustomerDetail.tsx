import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { addressLines, customerTitle, spentText } from "../lib/customers"
import { dateTime } from "../lib/format"
import { goBack } from "../lib/nav"
import { Digits, Empty, Section, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { OrderRow } from "../ui/OrderRow"
import { Scroll } from "../ui/Scroll"
import { CustomerProblem } from "./Customers"

const ORDERS_SHOWN = 20

export function CustomerDetail({ shopId, id }: { shopId: string; id: string }) {
  const { t, lang, shops } = useApp()
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const shop = shops.find((s) => s.id === shopId && (s.home || s.token))
  const query = useQuery({ queryKey: ["customer", shopId, id], queryFn: () => api.getCustomer(shop!, id), enabled: !!shop, retry: false })
  const orders = useQuery({
    queryKey: ["customer-orders", shopId, id],
    queryFn: () => api.listOrders(shop!, { offset: 0, scope: "any", customerId: id }),
    enabled: !!shop,
    retry: false,
  })
  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/customers") }
  const c = query.data
  const title = c ? customerTitle(c) : undefined
  const failure = query.isError ? api.catalogFailure(query.error) : null
  const missing = failure?.kind === "rejected" && failure.code === "medusify:no_customer"
  const spent = c ? spentText(c.stats, lang) : ""
  const shown = orders.data?.orders.slice(0, ORDERS_SHOWN) ?? []

  return (
    <div className="screen">
      <NavBar back={back} title={title} />
      <Scroll
        onRefresh={() => Promise.all([qc.invalidateQueries({ queryKey: ["customer"] }), qc.invalidateQueries({ queryKey: ["customer-orders"] })])}
        heading={{ title: title ?? t("cust.detail"), subtitle: shop && shops.length > 1 ? shop.name : undefined }}
      >
        {!shop ? <Empty icon="storefront" title={t("prod.noShop")} /> : null}
        {shop && query.isPending ? <Skeleton rows={4} /> : null}
        {shop && missing ? <Empty icon="users" title={t("cust.gone")} /> : null}
        {shop && query.isError && !missing ? <CustomerProblem error={query.error} onRetry={() => void query.refetch()} /> : null}
        {c ? (
          <>
            <dl className="group totals">
              <div className="kv"><dt>{t("cust.ordersLabel")}</dt><dd><Digits text={String(c.stats.orders)} /></dd></div>
              <div className="kv"><dt>{t("cust.spent")}</dt><dd>{spent ? <Digits text={spent} /> : "–"}</dd></div>
              <div className="kv"><dt>{t("cust.lastOrder")}</dt><dd>{c.stats.last_order_at ? dateTime(c.stats.last_order_at, lang) : "–"}</dd></div>
              <div className="kv"><dt>{t("cust.since")}</dt><dd>{dateTime(c.created_at, lang)}</dd></div>
            </dl>

            <Section id="contact" title={t("cust.contact")}>
              <div className="group plain">
                {c.email ? <a className="row" href={`mailto:${c.email}`}><span className="row-main"><span className="row-title reg tint wrap">{c.email}</span><span className="row-sub">{t("detail.mail")}</span></span></a> : null}
                {c.phone ? <a className="row" href={`tel:${c.phone.replace(/[^+\d]/g, "")}`}><span className="row-main"><span className="row-title reg tint">{c.phone}</span><span className="row-sub">{t("detail.call")}</span></span></a> : null}
                <p className="row single"><span className="row-main"><span className="row-title reg">{c.has_account ? t("cust.account") : t("cust.guest")}</span>{c.groups.length > 0 ? <span className="row-sub">{c.groups.map((g) => g.name).join(", ")}</span> : null}</span></p>
              </div>
            </Section>

            {c.addresses.length > 0 ? (
              <Section id="addresses" title={t("cust.addresses")}>
                <div className="group plain">
                  {c.addresses.map((a) => (
                    <div className="row single block" key={a.id}>
                      <span className="row-main">
                        <span className="row-sub address">{addressLines(a).join("\n")}</span>
                        {a.is_default_shipping || a.is_default_billing ? (
                          <span className="row-sub">{[a.is_default_shipping ? t("cust.defaultShipping") : null, a.is_default_billing ? t("cust.defaultBilling") : null].filter(Boolean).join(" · ")}</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            <Section id="orders" title={t("cust.ordersLabel")}>
              {orders.isPending ? <Skeleton rows={3} /> : null}
              {orders.isError ? <p className="note">{t("cust.ordersError")}</p> : null}
              {orders.data && shown.length === 0 ? <p className="note">{t("cust.noOrders")}</p> : null}
              {shop && shown.length > 0 ? (
                <div className="group">
                  {shown.map((o) => <OrderRow key={o.id} shop={shop} order={o} showShop={false} />)}
                </div>
              ) : null}
              {orders.data && orders.data.count > shown.length ? <p className="note">{t("cust.moreOrders", { n: orders.data.count - shown.length })}</p> : null}
            </Section>
          </>
        ) : null}
      </Scroll>
    </div>
  )
}
