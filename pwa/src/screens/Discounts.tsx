import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { catalogErrorText } from "../lib/catalog-text"
import { discountValue, type Discount } from "../lib/discounts"
import { goBack } from "../lib/nav"
import type { Shop } from "../lib/types"
import { useShopPick } from "../lib/use-shop-pick"
import { DiscountSheet } from "../ui/DiscountSheet"
import { Icon } from "../ui/Icon"
import { Digits, Empty, ErrorState, FieldError, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { Scroll } from "../ui/Scroll"
import { useToast } from "../ui/Toast"

function DiscountProblem({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const { t } = useApp()
  const f = api.catalogFailure(error)
  if (f.kind === "forbidden") return <Empty icon="lock-simple" title={t("disc.forbiddenTitle")} text={t("disc.forbiddenText")} />
  return <ErrorState text={t("disc.error")} onRetry={onRetry} />
}

function DiscountRow({ shop, d, mayEdit }: { shop: Shop; d: Discount; mayEdit: boolean }) {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = discountValue(d, lang)
  const uses = d.limit ? t("disc.usedOf", { n: d.used, of: d.limit }) : t("disc.used", { n: d.used })
  const state = d.status === "active" && d.limit !== null && d.used >= d.limit ? "used_up" : d.status
  const sub = [value, uses, d.is_automatic ? t("disc.automatic") : null].filter(Boolean).join(" · ")
  const next = d.status === "active" ? "inactive" : "active"

  async function toggle() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.setDiscountStatus(shop, d.id, next)
      await qc.invalidateQueries({ queryKey: ["discounts"] })
      toast.show(next === "active" ? t("disc.resumed", { code: d.code }) : t("disc.paused", { code: d.code }))
    } catch (e) {
      setError(catalogErrorText(t, e).text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="row">
      <span className="row-main">
        <span className="row-title mono">{d.code}</span>
        <span className="row-sub"><Digits text={sub} /></span>
        {error ? <FieldError id={`d-${d.id}`}>{error}</FieldError> : null}
      </span>
      <span className="row-end">
        <span className="stock" data-state={state}>{t(`disc.status.${state}` as "disc.status.active")}</span>
        {mayEdit ? (
          <button className="btn soft inline small" onClick={() => void toggle()} disabled={busy} aria-label={t(next === "active" ? "disc.resumeCode" : "disc.pauseCode", { code: d.code })}>
            {t(next === "active" ? (d.status === "draft" ? "disc.activate" : "disc.resume") : "disc.pause")}
          </button>
        ) : null}
      </span>
    </div>
  )
}

export function Discounts() {
  const { t } = useApp()
  const qc = useQueryClient()
  const [, navigate] = useLocation()
  const { shop, options, pick } = useShopPick()
  const [creating, setCreating] = useState(false)
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])

  const perms = useQuery({ queryKey: ["permissions", shop?.id], queryFn: () => api.getPermissions(shop!), enabled: !!shop, staleTime: 5 * 60_000, retry: false })
  const query = useInfiniteQuery({
    queryKey: ["discounts", shop?.id, q],
    queryFn: ({ pageParam }) => api.listDiscounts(shop!, { q, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.promotions.length < last.count && last.promotions.length > 0 ? last.offset + last.promotions.length : undefined),
    enabled: !!shop,
    retry: false,
  })
  const list = useMemo(() => query.data?.pages.flatMap((p) => p.promotions) ?? [], [query.data])

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
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, list.length])

  const mayCreate = perms.data?.discount_create !== false
  const mayEdit = perms.data?.discount_edit !== false
  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/more") }
  const trailing = shop && mayCreate ? (
    <button className="navbtn" onClick={() => setCreating(true)} aria-label={t("disc.new")}>
      <Icon name="plus" />
    </button>
  ) : undefined

  return (
    <div className="screen">
      <NavBar back={back} title={t("disc.title")} trailing={trailing} />
      <Scroll onRefresh={() => qc.invalidateQueries({ queryKey: ["discounts"] })} heading={{ title: t("disc.title") }}>
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
          <input type="search" name="q" enterKeyHint="search" autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder={t("disc.search")} aria-label={t("disc.search")} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {!shop ? <Empty icon="storefront" title={t("prod.noShop")} /> : null}
        {query.isPending && shop ? <Skeleton rows={5} /> : null}
        {query.isError && shop ? <DiscountProblem error={query.error} onRetry={() => void query.refetch()} /> : null}
        {shop && !query.isPending && !query.isError && list.length === 0 ? (
          q ? <Empty icon="magnifying-glass" title={t("prod.noResults", { q })} /> : <Empty icon="tag" title={t("disc.empty")} text={mayCreate ? t("disc.emptyText") : undefined} />
        ) : null}
        {shop && list.length > 0 ? (
          <div className="group">
            {list.map((d) => <DiscountRow key={d.id} shop={shop} d={d} mayEdit={mayEdit} />)}
          </div>
        ) : null}
        {hasNextPage ? (
          <div ref={sentinel} className="more-rows">
            <button className="btn soft inline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>{t("prod.more")}</button>
          </div>
        ) : null}
      </Scroll>
      {creating && shop ? <DiscountSheet shop={shop} onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
