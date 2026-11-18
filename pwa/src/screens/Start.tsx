import { useMemo, useState } from "react"
import { Link } from "wouter"
import { useApp } from "../app/context"
import { InstallHint } from "../features/InstallHint"
import { aggregateRevenue, recentOrders, type Period } from "../lib/dashboard"
import { currencyName, formatMoney, monthName, timeOfDay } from "../lib/format"
import { Icon } from "../ui/Icon"
import { Banner, Empty, ErrorState, Section, Segmented, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { OrderRow } from "../ui/OrderRow"
import { Scroll } from "../ui/Scroll"

export function Start() {
  const { t, lang, now, scoped, scope, dashboards, totalToShip, toShip, refetchDashboards, online } = useApp()
  const [period, setPeriod] = useState<Period>("today")
  const live = dashboards.filter((d) => scoped.some((s) => s.id === d.shop.id))
  const loaded = useMemo(() => live.filter((d): d is typeof d & { data: NonNullable<typeof d.data> } => !!d.data), [live])
  const failed = live.filter((d) => d.error && !d.data)
  const loading = live.length > 0 && loaded.length === 0 && failed.length === 0
  const updated = loaded.reduce((max, d) => Math.max(max, d.updatedAt), 0)
  const revenue = aggregateRevenue(loaded, period)
  const recent = recentOrders(loaded, 5)
  const many = scoped.length > 1
  const month = monthName(new Date(now), lang)
  const subtitle = updated
    ? online
      ? t("start.updated", { time: timeOfDay(new Date(updated), lang) })
      : t("common.offline", { time: timeOfDay(new Date(updated), lang) })
    : undefined

  return (
    <div className="screen">
      <NavBar scope title={t("start.title")} subtitle={subtitle} />
      <Scroll onRefresh={refetchDashboards}>
        {!online && !updated ? <Banner>{t("common.offlineNoData")}</Banner> : null}
        {failed.map((d) => (
          <Banner key={d.shop.id} icon="warning-circle" action={<button className="navbtn" onClick={() => void refetchDashboards()}>{t("common.retry")}</button>}>
            {t("start.shopDown", { name: d.shop.name })}
          </Banner>
        ))}
        <InstallHint signedIn />
        {loading ? <Skeleton rows={4} /> : null}
        {live.length > 0 && failed.length === live.length ? <ErrorState text={t("start.error")} onRetry={() => void refetchDashboards()} /> : null}

        {loaded.length > 0 ? (
          <>
            {totalToShip > 0 ? (
              <section className="band ship-band" aria-labelledby="ship-band-h">
                <h2 id="ship-band-h">{totalToShip === 1 ? t("start.toShip.one") : t("start.toShip.many", { n: totalToShip })}</h2>
                {many ? (
                  <ul className="band-shops">
                    {scoped.filter((s) => toShip[s.id]).map((s) => (
                      <li key={s.id}>
                        {s.name}
                        <span className="num">{toShip[s.id]}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Link className="btn primary" href="/ship">
                  <Icon name="package" size="sm" />
                  {t("start.begin")}
                </Link>
              </section>
            ) : (
              <p className="all-done">
                <Icon name="check-circle" size="sm" />
                {t("start.allShipped")}
              </p>
            )}

            <Section id="revenue" title={period === "today" ? t("start.revenue") : t("start.revenueIn", { month })} action={<Segmented<Period> value={period} onChange={setPeriod} label={t("start.revenue")} options={[{ value: "today", label: t("start.today") }, { value: "month", label: t("start.month") }]} />}>
              {revenue.length > 0 ? (
                <div className="group">
                  {revenue.map((r) => (
                    <div className="row" key={r.currency}>
                      <span className="row-main">
                        <span className="row-title reg">{currencyName(r.currency, lang)}</span>
                        <span className="row-sub">
                          {[r.orders !== null ? (r.orders === 1 ? t("start.orders.one") : t("start.orders.many", { n: r.orders })) : null, many ? (r.shops === 1 ? t("start.shops.one") : t("start.shops.many", { n: r.shops })) : null].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="amount big">{formatMoney(r.amount, r.currency, lang)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="group">
                  <p className="row single quiet">{period === "today" ? t("start.noOrdersToday") : t("start.noOrdersMonth")}</p>
                </div>
              )}
              {revenue.length > 1 ? <p className="foot">{t("start.currencies")}</p> : null}
            </Section>

            <Section id="recent" title={t("start.recent")} action={recent.length > 0 ? <Link href="/orders">{t("start.showAll")}</Link> : undefined}>
              {recent.length > 0 ? (
                <div className="group">
                  {recent.map(({ shop, order }) => (
                    <OrderRow key={`${shop.id}:${order.id}`} shop={shop} order={order} showShop={scope === "all" && many} />
                  ))}
                </div>
              ) : (
                <Empty icon="receipt" title={t("start.noRecent")} />
              )}
            </Section>
          </>
        ) : null}
      </Scroll>
    </div>
  )
}
