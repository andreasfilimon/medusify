import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState } from "react"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { currencyName, deviceTimezone, formatMoney, type Lang } from "../lib/format"
import { goBack } from "../lib/nav"
import { change, currencyRows, dayIn, rangeFor, rangeProblem, rangeText, returnRate, type Change, type Range, type RangeKind } from "../lib/reports"
import { useShopPick } from "../lib/use-shop-pick"
import { Digits, Empty, ErrorState, FieldError, Section, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { Scroll } from "../ui/Scroll"

/** "+12 %", "−8 %", "±0 %", "neu": the move against the period before, as text (never color alone). */
function changeText(c: Change, t: ReturnType<typeof useApp>["t"], lang: Lang): string | null {
  if (c.kind === "none") return null
  if (c.kind === "new") return t("rep.new")
  const n = new Intl.NumberFormat(lang === "de" ? "de-AT" : "en-GB").format(c.pct)
  return c.kind === "same" ? `±0 %` : `${c.kind === "up" ? "+" : "−"}${n} %`
}

/** A line break never starts a line with the dot. */
const SEP = "\u00a0· "

const percent = (n: number, lang: Lang) => `${new Intl.NumberFormat(lang === "de" ? "de-AT" : "en-GB", { maximumFractionDigits: 1 }).format(n)} %`

/**
 * Reports of one shop: a period and the one of the same length right before it. Revenue per currency (never added up or
 * converted), orders, average order value, the share of units that came back, and the products sold most. A list like the
 * start screen, no charts and no number cards (docs/DESIGN.md).
 */
export function Reports() {
  const { t, lang, now } = useApp()
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const { shop, options, pick } = useShopPick()
  const tz = deviceTimezone()
  const today = dayIn(new Date(now), tz)
  const [kind, setKind] = useState<RangeKind>("7d")
  const [typed, setTyped] = useState<Range>(() => rangeFor("7d", today))
  const ids = { from: useId(), to: useId() }
  const range = kind === "custom" ? typed : rangeFor(kind, today)
  const problem = kind === "custom" ? rangeProblem(typed) : null

  const report = useQuery({
    queryKey: ["report", shop?.id, range.from, range.to, tz],
    queryFn: () => api.getReport(shop!, range, tz),
    enabled: !!shop && !problem,
    retry: false,
    staleTime: 60_000,
  })
  const r = report.data
  const rows = r ? currencyRows(r) : []
  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/more") }
  const kinds: { value: RangeKind; label: string }[] = [
    { value: "7d", label: t("rep.7d") },
    { value: "30d", label: t("rep.30d") },
    { value: "month", label: t("rep.month") },
    { value: "custom", label: t("rep.custom") },
  ]
  const f = report.isError ? api.catalogFailure(report.error) : null
  const rateNow = r ? returnRate(r.current) : null
  const rateBefore = r ? returnRate(r.previous) : null

  return (
    <div className="screen">
      <NavBar back={back} title={t("rep.title")} />
      <Scroll onRefresh={() => qc.invalidateQueries({ queryKey: ["report"] })} heading={{ title: t("rep.title"), subtitle: shop && !problem ? rangeText(range, lang) : undefined }}>
        {options.length > 1 ? (
          <div className="chips" role="group" aria-label={t("prod.shop")}>
            {options.map((s) => (
              <button key={s.id} className="fchip" aria-pressed={s.id === shop?.id} onClick={() => pick(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="chips" role="group" aria-label={t("rep.period")}>
          {kinds.map((k) => (
            <button key={k.value} className="fchip" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>
              {k.label}
            </button>
          ))}
        </div>
        {kind === "custom" ? (
          <div className="form range-fields">
            <div className="field">
              <label htmlFor={ids.from}>{t("rep.from")}</label>
              <input id={ids.from} type="date" value={typed.from} max={today} onChange={(e) => setTyped((p) => ({ ...p, from: e.target.value }))} aria-invalid={!!problem} aria-describedby={problem ? `${ids.from}-e` : undefined} />
            </div>
            <div className="field">
              <label htmlFor={ids.to}>{t("rep.to")}</label>
              <input id={ids.to} type="date" value={typed.to} max={today} onChange={(e) => setTyped((p) => ({ ...p, to: e.target.value }))} aria-invalid={!!problem} />
            </div>
            {problem ? <FieldError id={`${ids.from}-e`}>{problem === "long" ? t("rep.tooLong") : t("rep.badOrder")}</FieldError> : null}
          </div>
        ) : null}

        {!shop ? <Empty icon="storefront" title={t("prod.noShop")} /> : null}
        {shop && !problem && report.isPending ? <Skeleton rows={5} /> : null}
        {f?.kind === "old" ? <Empty icon="chart-line" title={t("rep.oldTitle")} text={t("rep.oldText")} /> : null}
        {f?.kind === "forbidden" ? <Empty icon="lock-simple" title={t("rep.forbiddenTitle")} text={t("rep.forbiddenText")} /> : null}
        {f && f.kind !== "old" && f.kind !== "forbidden" ? <ErrorState text={t("rep.error")} onRetry={() => void report.refetch()} /> : null}

        {r ? (
          <>
            <Section id="rep-revenue" title={t("rep.revenue")}>
              {rows.length > 0 ? (
                <div className="group">
                  {rows.map(({ code, now: c, before }) => {
                    const move = changeText(change(c?.revenue ?? 0, before?.revenue ?? 0), t, lang)
                    const sub = [
                      c ? (c.orders === 1 ? t("start.orders.one") : t("start.orders.many", { n: c.orders })) : t("rep.noOrders"),
                      c && c.orders > 0 ? t("rep.average", { amount: formatMoney(c.average, code, lang) }) : null,
                    ].filter(Boolean).join(SEP)
                    return (
                      <div className="row" key={code}>
                        <span className="row-main">
                          <span className="row-title reg">{currencyName(code, lang)}</span>
                          <span className="row-sub">{sub}</span>
                          {move ? <span className="row-sub">{t("rep.vsBefore", { change: move })}</span> : null}
                        </span>
                        <Digits className="amount big" text={formatMoney(c?.revenue ?? 0, code, lang)} />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="group">
                  <p className="row single quiet">{t("rep.empty")}</p>
                </div>
              )}
              <p className="foot">{t("rep.compare", { range: rangeText({ from: r.previous.from, to: r.previous.to }, lang) })}</p>
              {rows.length > 1 ? <p className="foot">{t("start.currencies")}</p> : null}
            </Section>

            <Section id="rep-orders" title={t("rep.ordersAndReturns")}>
              <div className="group">
                <div className="row">
                  <span className="row-main">
                    <span className="row-title reg">{t("rep.orders")}</span>
                    <span className="row-sub">{[changeText(change(r.current.orders, r.previous.orders), t, lang), t("rep.before", { n: r.previous.orders })].filter(Boolean).join(SEP)}</span>
                  </span>
                  <Digits className="amount" text={String(r.current.orders)} />
                </div>
                <div className="row">
                  <span className="row-main">
                    <span className="row-title reg">{t("rep.returnRate")}</span>
                    <span className="row-sub">
                      {[
                        r.current.units > 0 ? t("rep.returnedOf", { n: r.current.returned_units, of: r.current.units }) : t("rep.nothingSold"),
                        rateBefore !== null ? t("rep.rateBefore", { rate: percent(rateBefore, lang) }) : null,
                      ].filter(Boolean).join(SEP)}
                    </span>
                  </span>
                  <Digits className="amount" text={rateNow !== null ? percent(rateNow, lang) : "–"} />
                </div>
              </div>
            </Section>

            <Section id="rep-top" title={t("rep.top")}>
              {r.top_products.length > 0 ? (
                <div className="group">
                  {r.top_products.map((p, i) => (
                    <div className="row" key={p.product_id ?? `${p.title}-${i}`}>
                      <span className="row-main">
                        <span className="row-title">{p.title}</span>
                        <span className="row-sub">{p.units === 1 ? t("rep.units.one") : t("rep.units.many", { n: p.units })}</span>
                      </span>
                      <span className="row-end">
                        {p.revenue.map((m) => <Digits key={m.currency_code} className="amount" text={formatMoney(m.amount, m.currency_code, lang)} />)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="group">
                  <p className="row single quiet">{t("rep.noTop")}</p>
                </div>
              )}
              <p className="foot">{t("rep.howCounted")}</p>
            </Section>
          </>
        ) : null}
      </Scroll>
    </div>
  )
}
