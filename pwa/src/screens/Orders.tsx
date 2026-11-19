import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { dayGroup } from "../lib/format"
import { initialCursor, loadFeedPage, rowKey } from "../lib/feed"
import type { OrderFilter } from "../lib/orders"
import { Icon } from "../ui/Icon"
import { Banner, Empty, ErrorState, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { OrderRow } from "../ui/OrderRow"
import { Scroll } from "../ui/Scroll"

const FILTERS: OrderFilter[] = ["open", "shipped", "canceled", "all"]

export function Orders() {
  const { t, lang, now, scoped, scope, shops, refetchDashboards } = useApp()
  const qc = useQueryClient()
  const [filter, setFilter] = useState<OrderFilter>("open")
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])

  const ids = scoped.map((s) => s.id).join(",")
  const query = useInfiniteQuery({
    queryKey: ["orders", ids, filter, q],
    queryFn: ({ pageParam }) => loadFeedPage(scoped, pageParam, { filter, q }, api.listOrders),
    initialPageParam: initialCursor(scoped),
    getNextPageParam: (last) => (last.done ? undefined : last.cursor),
    enabled: scoped.length > 0,
  })

  const pages = query.data?.pages ?? []
  const items = useMemo(() => pages.flatMap((p) => p.items), [pages])
  const failedIds = useMemo(() => [...new Set(pages.flatMap((p) => p.failed))], [pages])
  const failedShops = scoped.filter((s) => failedIds.includes(s.id))
  const allFailed = scoped.length > 0 && failedShops.length === scoped.length && items.length === 0

  // Group by day, newest first (the feed is already sorted per page; pages arrive newest to oldest).
  const groups = useMemo(() => {
    const out: { key: string; label: string; rows: typeof items }[] = []
    for (const row of items) {
      const g = dayGroup(row.order.created_at, now, lang)
      const last = out[out.length - 1]
      if (last && last.key === g.key) last.rows.push(row)
      else out.push({ ...g, rows: [row] })
    }
    return out
  }, [items, now, lang])

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
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length])

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["orders"] }), refetchDashboards()])
  }

  return (
    <div className="screen">
      <NavBar scope title={t("orders.title")} />
      <Scroll onRefresh={refresh} heading={{ title: t("orders.title") }}>
        <div className="search">
          <Icon name="magnifying-glass" size="sm" />
          <input type="search" name="q" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={t("orders.search")} aria-label={t("orders.search")} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="chips" role="group" aria-label={t("orders.title")}>
          {FILTERS.map((f) => (
            <button key={f} className="fchip" aria-pressed={f === filter} onClick={() => setFilter(f)}>
              {t(`orders.filter.${f}`)}
            </button>
          ))}
        </div>
        {failedShops.length > 0 && !allFailed ? (
          <Banner icon="warning-circle" action={<button className="navbtn" onClick={() => void query.refetch()}>{t("common.retry")}</button>}>
            {t("start.shopDown", { name: failedShops.map((s) => s.name).join(", ") })}
          </Banner>
        ) : null}
        {query.isPending && scoped.length > 0 ? <Skeleton rows={6} /> : null}
        {query.isError || allFailed ? <ErrorState text={t("orders.error")} onRetry={() => void query.refetch()} /> : null}
        {!query.isPending && !query.isError && !allFailed && items.length === 0 ? (
          q ? <Empty icon="magnifying-glass" title={t("orders.noResults", { q })} /> : <Empty icon="receipt" title={t(`orders.empty.${filter}`)} />
        ) : null}
        {groups.map((g) => (
          <Fragment key={g.key}>
            <section className="section" aria-label={g.label}>
              <div className="section-head"><h2>{g.label}</h2></div>
              <div className="group">
                {g.rows.map((row) => (
                  <OrderRow key={rowKey(row)} shop={row.shop} order={row.order} showShop={scope === "all" && shops.length > 1} />
                ))}
              </div>
            </section>
          </Fragment>
        ))}
        {hasNextPage ? (
          <div ref={sentinel} className="more-rows">
            <button className="btn soft inline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
              {t("orders.more")}
            </button>
          </div>
        ) : null}
      </Scroll>
    </div>
  )
}
