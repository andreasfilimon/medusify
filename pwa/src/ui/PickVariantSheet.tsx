import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { variantLabel } from "../lib/catalog"
import { catalogErrorText } from "../lib/catalog-text"
import { formatMoney } from "../lib/format"
import { lineMax, unitPrice, type ManualLine } from "../lib/manual-order"
import type { Shop } from "../lib/types"
import { Icon } from "./Icon"
import { Empty, Skeleton } from "./kit"
import { Sheet } from "./Sheet"

/** Search the catalog and tap a variant: it goes into the order. Sold-out variants the shop does not oversell stay greyed. */
export function PickVariantSheet({ shop, currency, onPick, onClose }: { shop: Shop; currency: string; onPick(line: Omit<ManualLine, "quantity">): void; onClose(): void }) {
  const { t, lang } = useApp()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])
  const found = useQuery({ queryKey: ["products", shop.id, "pick", q], queryFn: () => api.listProducts(shop, { q, limit: 20 }), retry: false })
  const rows = (found.data?.products ?? []).flatMap((p) => p.variants.map((v) => ({ p, v })))

  return (
    <Sheet title={t("mo.pickTitle")} onClose={onClose}>
      <div className="search">
        <Icon name="magnifying-glass" size="sm" />
        <input type="search" name="q" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus placeholder={t("prod.search")} aria-label={t("prod.search")} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {found.isPending ? <Skeleton rows={4} /> : null}
      {found.isError ? <Empty icon="warning-circle" title={catalogErrorText(t, found.error).text} /> : null}
      {!found.isPending && !found.isError && rows.length === 0 ? <Empty icon="magnifying-glass" title={q ? t("prod.noResults", { q }) : t("prod.empty")} /> : null}
      {rows.length > 0 ? (
        <div className="group">
          {rows.map(({ p, v }) => {
            const unit = unitPrice(v, currency)
            const max = lineMax(v)
            const label = variantLabel(v, p.title)
            const sub = [label, v.sku, max === null ? null : max === 0 ? t("mo.soldOut") : t("mo.inStock", { n: max })].filter(Boolean).join(" · ")
            return (
              <button
                key={v.id}
                type="button"
                className="row"
                disabled={max === 0}
                onClick={() => {
                  onPick({ variant_id: v.id, title: p.title, variant: label, unit, max })
                  onClose()
                }}
              >
                <span className="row-main">
                  <span className="row-title">{p.title}</span>
                  {sub ? <span className="row-sub">{sub}</span> : null}
                </span>
                <span className="row-end">{unit === null ? t("mo.noPrice") : formatMoney(unit, currency, lang)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </Sheet>
  )
}
