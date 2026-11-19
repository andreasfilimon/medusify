import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Link, useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { initialCursor, loadFeedPage, rowKey } from "../lib/feed"
import { goBack } from "../lib/nav"
import { customerName, orderState } from "../lib/orders"
import { Empty, ErrorState, Monogram, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { Scroll } from "../ui/Scroll"
import { ShipForm } from "../ui/ShipForm"

/** "Versand starten": one order after the other. After shipping, the next one opens by itself. */
export function ShipQueue() {
  const { t, scoped, shops } = useApp()
  const [, navigate] = useLocation()
  const [handled, setHandled] = useState<Set<string>>(new Set())
  const ids = scoped.map((s) => s.id).join(",")
  const query = useInfiniteQuery({
    queryKey: ["orders", "queue", ids],
    queryFn: ({ pageParam }) => loadFeedPage(scoped, pageParam, { filter: "open", q: "" }, api.listOrders),
    initialPageParam: initialCursor(scoped),
    getNextPageParam: (last) => (last.done ? undefined : last.cursor),
    enabled: scoped.length > 0,
    staleTime: 0,
  })
  const queue = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.items).filter((x) => ["to_ship", "partly"].includes(orderState(x.order))).filter((x) => !handled.has(rowKey(x))),
    [query.data, handled],
  )
  const current = queue[0]
  const back = { label: t("tab.start"), onClick: () => goBack(navigate, "/") }
  const mark = (key: string) => setHandled((prev) => new Set(prev).add(key))

  return (
    <div className="screen">
      <NavBar back={back} title={t("ship.title")} />
      <Scroll heading={{ title: t("ship.title") }}>
        {query.isPending ? <Skeleton rows={3} /> : null}
        {query.isError ? <ErrorState text={t("orders.error")} onRetry={() => void query.refetch()} /> : null}
        {!query.isPending && !query.isError && !current ? (
          <Empty icon="check-circle" title={handled.size > 0 ? t("ship.queueEnd") : t("ship.empty")} action={<Link className="btn soft inline" href="/">{t("tab.start")}</Link>} />
        ) : null}
        {current ? (
          <>
            <div className="group queue-card">
              <div className="row">
                {shops.length > 1 ? <Monogram shop={current.shop} /> : null}
                <span className="row-main">
                  <span className="row-title">{customerName(current.order)}</span>
                  <span className="row-sub">{[`#${current.order.display_id}`, shops.length > 1 ? current.shop.name : null, t("ship.remaining", { n: queue.length })].filter(Boolean).join(" · ")}</span>
                </span>
              </div>
            </div>
            <div className="queue-form">
              <ShipForm key={rowKey(current)} shop={current.shop} order={current.order} onDone={() => mark(rowKey(current))} />
              <button className="btn soft" onClick={() => mark(rowKey(current))}>{t("ship.skip")}</button>
            </div>
          </>
        ) : null}
      </Scroll>
    </div>
  )
}
