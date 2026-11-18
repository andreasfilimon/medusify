import { useCallback, useRef, useState, type ReactNode, type TouchEvent } from "react"
import { useApp } from "../app/context"

/** Pull distance: damped, capped. Pure so the thresholds are testable. */
export const PULL_MAX = 96
export const PULL_TRIGGER = 64
export const pullDistance = (dy: number) => Math.max(0, Math.min(dy * 0.5, PULL_MAX))
export const shouldRefresh = (pull: number) => pull >= PULL_TRIGGER

/** Scrolling content area with pull to refresh. The page itself never scrolls (overscroll is off). */
export function Scroll({ onRefresh, children, className }: { onRefresh?: () => Promise<unknown> | void; children: ReactNode; className?: string }) {
  const { t } = useApp()
  const ref = useRef<HTMLElement>(null)
  const start = useRef<number | null>(null)
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      start.current = ref.current && ref.current.scrollTop <= 0 && onRefresh ? (e.touches[0]?.clientY ?? null) : null
    },
    [onRefresh],
  )
  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      if (start.current === null || busy) return
      const dy = (e.touches[0]?.clientY ?? 0) - start.current
      setPull(dy > 0 ? pullDistance(dy) : 0)
    },
    [busy],
  )
  const onTouchEnd = useCallback(async () => {
    const go = shouldRefresh(pull)
    start.current = null
    setPull(0)
    if (!go || !onRefresh) return
    setBusy(true)
    try {
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }, [onRefresh, pull])

  return (
    <main
      ref={ref}
      className={`scroll${className ? ` ${className}` : ""}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => {
        start.current = null
        setPull(0)
      }}
    >
      <div className="pull" style={{ height: busy ? 44 : pull }} aria-live="polite">
        {busy ? <span className="sr">{t("orders.refreshing")}</span> : null}
        {pull > 8 || busy ? <span className={`spinner${busy ? " spin" : ""}`} style={busy ? undefined : { transform: `rotate(${pull * 4}deg)` }} aria-hidden="true" /> : null}
      </div>
      {children}
    </main>
  )
}
