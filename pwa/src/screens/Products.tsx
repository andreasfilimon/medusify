import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { useLowThreshold } from "../lib/use-low-threshold"
import { useShopPick } from "../lib/use-shop-pick"
import { Icon } from "../ui/Icon"
import { Empty, ErrorState, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { ProductRow } from "../ui/ProductRow"
import { Scroll } from "../ui/Scroll"

/** What a failed catalog read means on screen: a plugin that is too old, a role without the right, or a plain error. */
export function CatalogProblem({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const { t } = useApp()
  const f = api.catalogFailure(error)
  if (f.kind === "old") return <Empty icon="package" title={t("prod.oldTitle")} text={t("prod.oldText")} />
  if (f.kind === "forbidden") return <Empty icon="lock-simple" title={t("prod.forbiddenTitle")} text={t("prod.forbiddenText")} />
  return <ErrorState text={t("prod.error")} onRetry={onRetry} />
}

export function Products() {
  const { t } = useApp()
  const qc = useQueryClient()
  const { shop, options, pick } = useShopPick()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])

  const threshold = useLowThreshold(shop)
  const perms = useQuery({ queryKey: ["permissions", shop?.id], queryFn: () => api.getPermissions(shop!), enabled: !!shop, staleTime: 5 * 60_000, retry: false })
  const query = useInfiniteQuery({
    queryKey: ["products", shop?.id, q],
    queryFn: ({ pageParam }) => api.listProducts(shop!, { q, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.products.length < last.count && last.products.length > 0 ? last.offset + last.products.length : undefined),
    enabled: !!shop,
    retry: false,
  })
  const products = useMemo(() => query.data?.pages.flatMap((p) => p.products) ?? [], [query.data])

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
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, products.length])

  const mayScan = perms.data?.catalog !== false && perms.data?.stock !== false
  const mayCreate = perms.data?.product_create !== false
  const trailing = shop ? (
    <span className="navtrail">
      {mayScan ? (
        <Link className="navbtn" href={`/products/scan/${encodeURIComponent(shop.id)}`} aria-label={t("prod.scan")}>
          <Icon name="barcode" />
        </Link>
      ) : null}
      {mayCreate ? (
        <Link className="navbtn" href={`/products/new/${encodeURIComponent(shop.id)}`} aria-label={t("prod.new")}>
          <Icon name="plus" />
        </Link>
      ) : null}
    </span>
  ) : undefined

  return (
    <div className="screen">
      <NavBar scope title={t("prod.title")} trailing={trailing} />
      <Scroll onRefresh={() => qc.invalidateQueries({ queryKey: ["products"] })} heading={{ title: t("prod.title") }}>
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
          <input type="search" name="q" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={t("prod.search")} aria-label={t("prod.search")} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {query.isPending && shop ? <Skeleton rows={6} /> : null}
        {query.isError && shop ? <CatalogProblem error={query.error} onRetry={() => void query.refetch()} /> : null}
        {!query.isPending && !query.isError && products.length === 0 ? (
          q ? (
            <Empty icon="magnifying-glass" title={t("prod.noResults", { q })} />
          ) : (
            <Empty icon="package" title={t("prod.empty")} text={mayCreate ? t("prod.emptyText") : undefined} />
          )
        ) : null}
        {shop && products.length > 0 ? (
          <div className="group">
            {products.map((p) => (
              <ProductRow key={p.id} shop={shop} product={p} threshold={threshold} />
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
