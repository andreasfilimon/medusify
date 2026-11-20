import { Link } from "wouter"
import { useApp } from "../app/context"
import { isLow, listPrice, productStock, variantLabel, type ProductView } from "../lib/catalog"
import { formatMoney } from "../lib/format"
import type { Shop } from "../lib/types"
import { Icon } from "./Icon"
import { Digits } from "./kit"

/** The picture of a product, or a plain tile when it has none. */
export function ProductThumb({ src }: { src: string | null }) {
  return (
    <span className="thumb prod" aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} /> : <Icon name="image-square" size="sm" />}
    </span>
  )
}

/** The stock of a product as a chip: the number, red at or below the threshold, "ausverkauft" at zero, nothing for untracked. */
export function StockChip({ stock, threshold }: { stock: number | null; threshold: number }) {
  const { t } = useApp()
  if (stock === null) return <span className="stock none">{t("prod.untracked")}</span>
  const out = stock <= 0
  return (
    <span className="stock" data-low={isLow(stock, threshold) ? (out ? "out" : "low") : undefined}>
      {out ? t("prod.soldOut") : <Digits text={t("prod.stockN", { n: stock })} />}
    </span>
  )
}

export const productHref = (shop: Shop, id: string) => `/products/${encodeURIComponent(shop.id)}/${encodeURIComponent(id)}`

/** One product in the list: picture, name, state and price, stock on the right. */
export function ProductRow({ shop, product, threshold }: { shop: Shop; product: ProductView; threshold: number }) {
  const { t, lang } = useApp()
  const stock = productStock(product)
  const price = listPrice(product)
  const sub = [
    product.status === "published" ? null : t(`prod.status.${product.status === "draft" ? "draft" : "other"}`),
    product.variants.length > 1 ? t("prod.variants", { n: product.variants.length }) : variantLabel(product.variants[0] ?? { title: "" }, product.title) || null,
  ].filter(Boolean).join(" · ")
  const money = price ? `${price.several ? t("prod.from") + " " : ""}${formatMoney(price.amount, price.currency, lang)}` : ""
  return (
    <Link className="row" draggable={false} href={productHref(shop, product.id)} aria-label={[product.title, sub, money, stock === null ? "" : t("prod.stockN", { n: stock })].filter(Boolean).join(", ")}>
      <ProductThumb src={product.thumbnail} />
      <span className="row-main">
        <span className="row-title">{product.title}</span>
        {sub ? <span className="row-sub">{sub}</span> : null}
      </span>
      <span className="row-end">
        {money ? <Digits className="amount" text={money} /> : null}
        <StockChip stock={stock} threshold={threshold} />
      </span>
    </Link>
  )
}
