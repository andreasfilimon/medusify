import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { basePrice, editableInventory, variantLabel, type ProductView, type VariantView } from "../lib/catalog"
import { catalogErrorText } from "../lib/catalog-text"
import { formatMoney } from "../lib/format"
import { goBack } from "../lib/nav"
import type { Shop } from "../lib/types"
import { useLowThreshold } from "../lib/use-low-threshold"
import { AddLevelSheet } from "../ui/AddLevelSheet"
import { Icon } from "../ui/Icon"
import { Digits, Empty, FieldError, Section, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { PriceSheet } from "../ui/PriceSheet"
import { ProductThumb, StockChip } from "../ui/ProductRow"
import { Scroll } from "../ui/Scroll"
import { StockLevel } from "../ui/StockLevel"
import { useToast } from "../ui/Toast"
import { CatalogProblem } from "./Products"
import { ALL_ALLOWED, type Permissions } from "../lib/actions"

/** Draft or published. Needs the right "product_status"; the shop's own answer decides, the switch shows it afterwards. */
function StatusSwitch({ shop, product, allowed }: { shop: Shop; product: ProductView; allowed: boolean }) {
  const { t, online } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const on = product.status === "published"
  const known = product.status === "published" || product.status === "draft"

  async function flip() {
    if (pending.current || !allowed || !known) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await api.setProductStatus(shop, product.id, on ? "draft" : "published")
      await Promise.all([qc.invalidateQueries({ queryKey: ["product"] }), qc.invalidateQueries({ queryKey: ["products"] })])
      toast.show(on ? t("prod.statusDraftDone") : t("prod.statusPublishedDone"))
    } catch (err) {
      setError(catalogErrorText(t, err).text)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <>
      <div className="group">
        <button type="button" role="switch" aria-checked={on} className="switch row-switch" disabled={!allowed || !known || busy || !online} onClick={() => void flip()}>
          <span className="row-main">
            <span className="row-title">{t("prod.visible")}</span>
            <span className="row-sub">{known ? (on ? t("prod.visibleOn") : t("prod.visibleOff")) : t("prod.statusOther")}</span>
          </span>
          <span className="track" aria-hidden="true" />
        </button>
      </div>
      {!allowed ? <p className="note">{t("prod.noRightStatus")}</p> : null}
      {error ? <FieldError id="status-err">{error}</FieldError> : null}
    </>
  )
}

function VariantBlock({ shop, product, variant, perms, threshold }: { shop: Shop; product: ProductView; variant: VariantView; perms: Permissions; threshold: number }) {
  const { t, lang } = useApp()
  const [pricing, setPricing] = useState<{ currency: string; amount: number | null } | null>(null)
  const [adding, setAdding] = useState(false)
  const label = variantLabel(variant, product.title)
  const inv = editableInventory(variant)
  const bases = variant.prices.filter((p) => p.base)
  const others = variant.prices.length - bases.length
  const codes = [variant.barcode, variant.ean, variant.upc].filter((c, i, all): c is string => !!c && all.indexOf(c) === i)
  const canPrice = perms.variant_edit
  const canStock = perms.stock

  return (
    <Section id={`v-${variant.id}`} title={label || t("prod.variantOnly")}>
      <div className="group">
        {variant.sku ? <div className="kv"><dt>{t("prod.sku")}</dt><dd className="num">{variant.sku}</dd></div> : null}
        {codes.map((c) => <div className="kv" key={c}><dt>{t("prod.code")}</dt><dd className="num">{c}</dd></div>)}
        {bases.map((p) => (
          <button key={p.id} className="row" disabled={!canPrice} onClick={() => setPricing({ currency: p.currency_code, amount: p.amount })} aria-label={t("prod.priceRow", { currency: p.currency_code.toUpperCase(), amount: formatMoney(p.amount, p.currency_code, lang) })}>
            <span className="thumb" aria-hidden="true"><Icon name="tag" size="sm" /></span>
            <span className="row-main"><span className="row-title">{t("prod.price")}</span><span className="row-sub">{p.currency_code.toUpperCase()}</span></span>
            <span className="row-end inline"><Digits className="amount" text={formatMoney(p.amount, p.currency_code, lang)} />{canPrice ? <Icon name="caret-right" size="xs" /> : null}</span>
          </button>
        ))}
        {bases.length === 0 ? <div className="kv"><dt>{t("prod.price")}</dt><dd>{t("prod.noPrice")}</dd></div> : null}
        {others > 0 ? <p className="note">{t("prod.otherPrices", { n: others })}</p> : null}
        {variant.prices.length > 0 && bases.length === 0 ? <p className="note">{t("prod.rulePricesOnly")}</p> : null}
      </div>
      {!canPrice ? <p className="note">{t("prod.noRightPrice")}</p> : null}

      <div className="section-head sub"><h3>{t("prod.stock")}</h3><StockChip stock={variant.stock_total} threshold={threshold} /></div>
      {inv ? (
        <div className="group levels">
          {inv.levels.map((lv) => (
            <StockLevel key={lv.location_id} shop={shop} inventoryItemId={inv.inventory_item_id} level={lv} canEdit={canStock} label={t("prod.stockAt", { place: lv.location_name })} />
          ))}
          {inv.levels.length === 0 ? <p className="note">{t("prod.noLevels")}</p> : null}
          {canStock && perms.stock_new_level ? (
            <button className="row add" onClick={() => setAdding(true)}>
              <span className="thumb" aria-hidden="true"><Icon name="plus" size="sm" /></span>
              <span className="row-main"><span className="row-title">{t("prod.addPlace")}</span></span>
            </button>
          ) : null}
        </div>
      ) : (
        <p className="note">{variant.stock_hidden ? t("prod.noRightStockRead") : variant.stock_total === null ? t("prod.untrackedHint") : t("prod.kitHint")}</p>
      )}
      {!canStock && inv ? <p className="note">{t("prod.noRightStock")}</p> : null}
      {pricing ? <PriceSheet shop={shop} variantId={variant.id} currency={pricing.currency} current={basePrice(variant, pricing.currency)?.amount ?? pricing.amount} label={[product.title, label].filter(Boolean).join(" · ")} onClose={() => setPricing(null)} /> : null}
      {adding && inv ? <AddLevelSheet shop={shop} inventoryItemId={inv.inventory_item_id} have={inv.levels.map((l) => l.location_id)} onClose={() => setAdding(false)} /> : null}
    </Section>
  )
}

export function ProductDetail({ shopId, id }: { shopId: string; id: string }) {
  const { t, shops } = useApp()
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const shop = shops.find((s) => s.id === shopId && (s.home || s.token))
  const threshold = useLowThreshold(shop)
  const perms = useQuery({ queryKey: ["permissions", shopId], queryFn: () => api.getPermissions(shop!), enabled: !!shop, staleTime: 5 * 60_000, retry: false })
  const query = useQuery({ queryKey: ["product", shopId, id], queryFn: () => api.getProduct(shop!, id), enabled: !!shop, retry: false })
  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/products") }
  const p = query.data
  const failure = query.isError ? api.catalogFailure(query.error) : null
  const missing = failure?.kind === "rejected" && failure.code === "medusify:no_product"

  return (
    <div className="screen">
      <NavBar back={back} title={p?.title} />
      <Scroll onRefresh={() => qc.invalidateQueries({ queryKey: ["product"] })} heading={{ title: p?.title ?? t("prod.detail") , subtitle: shop && shops.length > 1 ? shop.name : undefined }}>
        {!shop ? <Empty icon="storefront" title={t("prod.noShop")} /> : null}
        {shop && query.isPending ? <Skeleton rows={4} /> : null}
        {shop && missing ? <Empty icon="package" title={t("prod.gone")} /> : null}
        {shop && query.isError && !missing ? <CatalogProblem error={query.error} onRetry={() => void query.refetch()} /> : null}
        {shop && p ? (
          <>
            <div className="prod-head">
              <ProductThumb src={p.thumbnail} />
              <span className="row-main">
                <span className="row-title">{p.title}</span>
                <span className="row-sub">{p.variants.length > 1 ? t("prod.variants", { n: p.variants.length }) : t("prod.oneVariant")}</span>
              </span>
            </div>
            <Section id="status"><StatusSwitch shop={shop} product={p} allowed={perms.data?.product_status !== false} /></Section>
            {p.variants.map((v) => (
              <VariantBlock key={v.id} shop={shop} product={p} variant={v} perms={perms.data ?? ALL_ALLOWED} threshold={threshold} />
            ))}
          </>
        ) : null}
      </Scroll>
    </div>
  )
}

/**
 * `/products/<id>` without a shop: the address a low-stock push opens (the plugin knows the product, not the app's shop
 * id). Asks every signed-in shop for the product, like the order detail does, and moves on to the shop that has it.
 */
export function ProductLink({ id }: { id: string }) {
  const { t, shops } = useApp()
  const [, navigate] = useLocation()
  const authed = shops.filter((s) => s.home || s.token)
  const query = useQuery({
    queryKey: ["product-link", id, authed.map((s) => s.id).join(",")],
    queryFn: async () => {
      const results = await Promise.allSettled(authed.map(async (shop) => ({ shop, product: await api.getProduct(shop, id) })))
      const hit = results.find((r): r is PromiseFulfilledResult<{ shop: Shop; product: ProductView }> => r.status === "fulfilled")
      if (!hit) throw new api.ApiError("notfound", 404)
      return hit.value.shop.id
    },
    enabled: authed.length > 0,
    retry: false,
  })
  useEffect(() => {
    if (query.data) navigate(`/products/${encodeURIComponent(query.data)}/${encodeURIComponent(id)}`, { replace: true })
  }, [query.data, id, navigate])
  if (query.data) return null
  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/products") }
  return (
    <div className="screen">
      <NavBar back={back} title={t("prod.detail")} />
      <Scroll heading={{ title: t("prod.detail") }}>
        {authed.length === 0 ? <Empty icon="storefront" title={t("prod.noShop")} /> : null}
        {query.isPending && authed.length > 0 ? <Skeleton rows={4} /> : null}
        {query.isError ? <Empty icon="package" title={t("prod.gone")} /> : null}
      </Scroll>
    </div>
  )
}
