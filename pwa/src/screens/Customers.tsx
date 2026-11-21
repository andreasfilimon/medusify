import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { customerTitle, spentText, type CustomerView } from "../lib/customers"
import { relativeTime } from "../lib/format"
import { goBack } from "../lib/nav"
import { useShopPick } from "../lib/use-shop-pick"
import type { Shop } from "../lib/types"
import { Icon } from "../ui/Icon"
import { Digits, Empty, ErrorState, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { Scroll } from "../ui/Scroll"

/** A failed customer read: a plugin without the route (older than 0.4.0), a role without the right, or a plain error. */
export function CustomerProblem({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const { t } = useApp()
  const f = api.catalogFailure(error)
  if (f.kind === "old") return <Empty icon="users" title={t("cust.oldTitle")} text={t("cust.oldText")} />
  if (f.kind === "forbidden") return <Empty icon="lock-simple" title={t("cust.forbiddenTitle")} text={t("cust.forbiddenText")} />
  return <ErrorState text={t("cust.error")} onRetry={onRetry} />
}

export const customerHref = (shop: Shop, id: string) => `/customers/${encodeURIComponent(shop.id)}/${encodeURIComponent(id)}`

function CustomerRow({ shop, customer }: { shop: Shop; customer: CustomerView }) {
  const { t, lang, now } = useApp()
  const title = customerTitle(customer)
  const s = customer.stats
  const sub = [
    title === customer.email ? null : customer.email,
    s.orders === 0 ? t("cust.noOrders") : s.orders === 1 ? t("cust.orders1") : t("cust.orders", { n: s.orders }),
    s.last_order_at ? relativeTime(s.last_order_at, now, lang) : null,
  ].filter(Boolean).join(" · ")
  const spent = spentText(s, lang)
  return (
    <Link className="row" draggable={false} href={customerHref(shop, customer.id)} aria-label={[title, sub, spent].filter(Boolean).join(", ")}>
      <span className="row-main">
        <span className="row-title">{title}</span>
        {sub ? <span className="row-sub">{sub}</span> : null}
      </span>
      <span className="row-end">{spent ? <Digits className="amount" text={spent} /> : null}</span>
    </Link>
  )
}

export function Customers() {
  const { t } = useApp()
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const { shop, options, pick } = useShopPick()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])

  const query = useInfiniteQuery({
    queryKey: ["customers", shop?.id, q],
    queryFn: ({ pageParam }) => api.listCustomers(shop!, { q, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.customers.length < last.count && last.customers.length > 0 ? last.offset + last.customers.length : undefined),
    enabled: !!shop,
    retry: false,
  })
  const customers = useMemo(() => query.data?.pages.flatMap((p) => p.customers) ?? [], [query.data])

  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage()
    })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, customers.length])

  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/more") }
  return (
    <div className="screen">
      <NavBar back={back} title={t("cust.title")} />
      <Scroll onRefresh={() => qc.invalidateQueries({ queryKey: ["customers"] })} heading={{ title: t("cust.title") }}>
        {options.length > 1 ? (
          <div className="chips" role="group" aria-label={t("prod.shop")}>
            {options.map((s) => (
              <button key={s.id} className="fchip" aria-pressed={s.id === shop?.id} onClick={() => pick(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="search">
          <Icon name="magnifying-glass" size="sm" />
          <input type="search" name="q" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={t("cust.search")} aria-label={t("cust.search")} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {!shop ? <Empty icon="storefront" title={t("prod.noShop")} /> : null}
        {query.isPending && shop ? <Skeleton rows={6} /> : null}
        {query.isError && shop ? <CustomerProblem error={query.error} onRetry={() => void query.refetch()} /> : null}
        {shop && !query.isPending && !query.isError && customers.length === 0 ? (
          q ? <Empty icon="magnifying-glass" title={t("prod.noResults", { q })} /> : <Empty icon="users" title={t("cust.empty")} />
        ) : null}
        {shop && customers.length > 0 ? (
          <div className="group">
            {customers.map((c) => (
              <CustomerRow key={c.id} shop={shop} customer={c} />
            ))}
          </div>
        ) : null}
        {hasNextPage ? (
          <div ref={sentinel} className="more-rows">
            <button className="btn soft inline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
              {t("prod.more")}
            </button>
          </div>
        ) : null}
      </Scroll>
    </div>
  )
}
