import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { variantLabel, type LookupMatch, type ProductView, type VariantView } from "../lib/catalog"
import { catalogErrorText } from "../lib/catalog-text"
import type { Shop } from "../lib/types"
import { Icon } from "./Icon"
import { Empty, FieldError } from "./kit"
import { ProductThumb } from "./ProductRow"
import { Sheet } from "./Sheet"

/**
 * An unknown code: the code is shown, and (with the right to edit variants) the user searches the product it belongs to.
 * One tap on a variant writes the code onto it and hands the match back, so the scan that found nothing is counted at once.
 * A variant that already has a code says so; the new one replaces it.
 */
export function AssignSheet({ shop, code, canAssign, onAssigned, onClose }: { shop: Shop; code: string; canAssign: boolean; onAssigned(match: LookupMatch): void; onClose(): void }) {
  const { t } = useApp()
  const [text, setText] = useState("")
  const [q, setQ] = useState("")
  const [open, setOpen] = useState<ProductView | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300)
    return () => clearTimeout(id)
  }, [text])
  const found = useQuery({ queryKey: ["assign-search", shop.id, q], queryFn: () => api.listProducts(shop, { q, limit: 12 }), enabled: canAssign, retry: false })

  async function assign(product: ProductView, variant: VariantView) {
    if (busy) return
    setBusy(variant.id)
    setError(null)
    try {
      await api.setVariantBarcode(shop, product.id, variant.id, code)
      const { variants: _variants, ...rest } = product
      onAssigned({ product: rest, variant: { ...variant, barcode: code }, matched_by: "barcode" })
    } catch (err) {
      setError(catalogErrorText(t, err).text)
      setBusy(null)
    }
  }

  const list = found.data?.products ?? []
  return (
    <Sheet title={t("scan.unknownTitle")} onClose={onClose} locked={!!busy}>
      <p className="sheet-text">{t("scan.unknownText", { code })}</p>
      {!canAssign ? <p className="note">{t("scan.noRightAssign")}</p> : (
        <>
          <div className="search in-sheet">
            <Icon name="magnifying-glass" size="sm" />
            <input type="search" name="q" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" placeholder={t("prod.search")} aria-label={t("scan.assignSearch")} value={text} onChange={(e) => { setText(e.target.value); setOpen(null) }} />
          </div>
          {found.isError ? <FieldError id="assign-err">{catalogErrorText(t, found.error).text}</FieldError> : null}
          {!found.isPending && !found.isError && list.length === 0 ? <Empty icon="magnifying-glass" title={t("prod.noResults", { q })} /> : null}
          {!open && list.length > 0 ? (
            <div className="group">
              {list.map((p) => (
                <button key={p.id} className="row" disabled={!!busy} onClick={() => (p.variants.length === 1 ? void assign(p, p.variants[0]!) : setOpen(p))}>
                  <ProductThumb src={p.thumbnail} />
                  <span className="row-main"><span className="row-title">{p.title}</span><span className="row-sub">{p.variants.length > 1 ? t("prod.variants", { n: p.variants.length }) : p.variants[0]?.barcode ? t("scan.replaces", { code: p.variants[0].barcode }) : ""}</span></span>
                </button>
              ))}
            </div>
          ) : null}
          {open ? (
            <div className="group">
              {open.variants.map((v) => (
                <button key={v.id} className="row" disabled={!!busy} onClick={() => void assign(open, v)}>
                  <span className="row-main"><span className="row-title">{variantLabel(v, open.title) || open.title}</span><span className="row-sub">{v.barcode ? t("scan.replaces", { code: v.barcode }) : v.sku ?? ""}</span></span>
                </button>
              ))}
            </div>
          ) : null}
          {error ? <FieldError id="assign-err2">{error}</FieldError> : null}
        </>
      )}
    </Sheet>
  )
}
