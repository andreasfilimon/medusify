import { useEffect, useRef, type ReactNode } from "react"
import { useApp } from "../app/context"
import type { OrderState } from "../lib/orders"
import { monogram } from "../lib/shops"
import type { Shop } from "../lib/types"
import { Icon, type IconName } from "./Icon"

export function Monogram({ shop, small }: { shop: Pick<Shop, "name" | "color">; small?: boolean }) {
  return (
    <span className={`monogram${small ? " sm" : ""} shop-${shop.color}`} aria-hidden="true">
      {monogram(shop.name)}
    </span>
  )
}

const CHIP: Record<OrderState, { cls: string; icon: IconName }> = {
  to_ship: { cls: "warn", icon: "package" },
  partly: { cls: "warn", icon: "package" },
  payment_pending: { cls: "neutral", icon: "clock" },
  refunded: { cls: "neutral", icon: "x-circle" },
  shipped: { cls: "neutral", icon: "check" },
  canceled: { cls: "danger", icon: "x-circle" },
  open: { cls: "neutral", icon: "clock" },
}

export function StateChip({ state }: { state: OrderState }) {
  const { t } = useApp()
  const c = CHIP[state]
  return (
    <span className={`chip ${c.cls}`}>
      <Icon name={c.icon} size="xs" />
      {t(`state.${state}`)}
    </span>
  )
}

export function Section({ title, action, children, id }: { title?: string; action?: ReactNode; children: ReactNode; id: string }) {
  return (
    <section className="section" aria-labelledby={`${id}-h`}>
      {title || action ? (
        <div className="section-head">
          {title ? <h2 id={`${id}-h`}>{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange(v: T): void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Banner({ icon = "wifi-slash", children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="banner" role="status">
      <Icon name={icon} size="sm" />
      <span className="banner-text">{children}</span>
      {action}
    </div>
  )
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="group" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="row skeleton" key={i}>
          <span className="monogram sk" />
          <span className="row-main">
            <span className="sk-line w60" />
            <span className="sk-line w40" />
          </span>
          <span className="sk-line w20" />
        </div>
      ))}
    </div>
  )
}

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size="lg" />
      </span>
      <h2>{title}</h2>
      {text ? <p>{text}</p> : null}
      {action}
    </div>
  )
}

export function ErrorState({ text, onRetry }: { text: string; onRetry(): void }) {
  const { t } = useApp()
  return (
    <div className="empty" role="alert">
      <span className="empty-icon">
        <Icon name="warning-circle" size="lg" />
      </span>
      <h2>{text}</h2>
      <button className="btn soft inline" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  )
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="field-error" id={id} role="alert">
      <Icon name="warning-circle" size="xs" />
      {children}
    </p>
  )
}

/**
 * A number or amount whose changed digits roll in (a short rise with a fade, transform and opacity only). The first render and
 * unchanged digits stay still. The text is the plain string, so reading and finding it works as without the animation.
 * Places are matched from the end, so a new thousands digit does not make every digit move.
 */
export function Digits({ text, className }: { text: string; className?: string }) {
  const before = useRef<string | null>(null)
  const old = before.current
  useEffect(() => {
    before.current = text
  })
  const chars = [...text]
  const oldChars = old === null ? null : [...old]
  return (
    <span className={className}>
      {chars.map((ch, i) => {
        const place = chars.length - i
        const was = oldChars ? oldChars[oldChars.length - place] : undefined
        const rolls = oldChars !== null && old !== text && ch !== was && /\d/.test(ch)
        return (
          <span key={`${place}:${ch}`} className={rolls ? "d roll" : undefined}>
            {ch}
          </span>
        )
      })}
    </span>
  )
}
