import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useApp } from "../app/context"
import { collapseState, initScrollMode } from "../lib/scroll-mode"
import { Icon } from "./Icon"

/** Pull distance: damped, capped. Pure so the thresholds are testable. */
export const PULL_MAX = 96
export const PULL_TRIGGER = 64
export const pullDistance = (dy: number) => Math.max(0, Math.min(dy * 0.5, PULL_MAX))
export const shouldRefresh = (pull: number) => pull >= PULL_TRIGGER

/**
 * Scrolling content area. The page itself never scrolls (overscroll is off). `heading` is the large title: it scrolls with
 * the content and shrinks into the bar. Pull to refresh moves the content with a transform and shows an arrow that turns
 * once the pull is long enough; while it loads, three dots pulse. No spinner, no layout change while pulling.
 */
export function Scroll({
  onRefresh, children, className, heading,
}: {
  onRefresh?: () => Promise<unknown> | void
  children: ReactNode
  className?: string
  heading?: { title: string; subtitle?: string }
}) {
  const { t } = useApp()
  const ref = useRef<HTMLElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const arrow = useRef<HTMLDivElement>(null)
  const start = useRef<number | null>(null)
  const pulled = useRef(0)
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const refresh = useRef(onRefresh)
  refresh.current = onRefresh

  useEffect(() => initScrollMode(), [])

  // Fallback for the bar: mirror the scroll position into attributes on the screen. Native scroll-driven animations need none of it.
  useEffect(() => {
    const el = ref.current
    const screen = el?.closest<HTMLElement>(".screen")
    if (!el || !screen) return
    let frame = 0
    const sync = () => {
      frame = 0
      if (document.documentElement.hasAttribute("data-sda")) return
      const s = collapseState(el.scrollTop)
      screen.toggleAttribute("data-collapsed", s.collapsed)
      screen.toggleAttribute("data-title", s.title && !!heading)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync)
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    sync()
    return () => {
      el.removeEventListener("scroll", onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [heading])

  const show = useCallback((px: number, animate: boolean) => {
    const b = body.current
    const a = arrow.current
    if (!b || !a) return
    b.style.transition = animate ? "transform var(--dur-spring-settle) var(--ease-spring-settle)" : "none"
    b.style.transform = px > 0 ? `translateY(${px}px)` : ""
    const progress = Math.min(1, px / PULL_TRIGGER)
    a.style.transition = animate ? "opacity var(--dur-fade) var(--ease-out)" : "none"
    a.style.opacity = String(px > 6 ? Math.min(1, progress * 1.4) : 0)
    a.style.transform = `translateY(${Math.min(px, PULL_MAX) / 2 - 22}px) scale(${0.6 + progress * 0.4})`
  }, [])

  // Non-passive listeners: while the pull is on, the browser must not scroll or bounce the page as well.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onStart = (e: TouchEvent) => {
      start.current = el.scrollTop <= 0 && refresh.current && !busyRef.current ? (e.touches[0]?.clientY ?? null) : null
    }
    const onMove = (e: TouchEvent) => {
      if (start.current === null) return
      const dy = (e.touches[0]?.clientY ?? 0) - start.current
      if (dy <= 0 || el.scrollTop > 0) {
        if (pulled.current) {
          pulled.current = 0
          show(0, false)
          setArmed(false)
        }
        return
      }
      if (e.cancelable) e.preventDefault()
      pulled.current = pullDistance(dy)
      show(pulled.current, false)
      const now = shouldRefresh(pulled.current)
      setArmed((was) => (was === now ? was : now))
    }
    const onEnd = async () => {
      const go = shouldRefresh(pulled.current)
      start.current = null
      pulled.current = 0
      setArmed(false)
      if (!go || !refresh.current) {
        show(0, true)
        return
      }
      busyRef.current = true
      setBusy(true)
      show(44, true)
      try {
        await refresh.current()
      } finally {
        busyRef.current = false
        setBusy(false)
        show(0, true)
      }
    }
    const onCancel = () => {
      start.current = null
      pulled.current = 0
      setArmed(false)
      show(0, true)
    }
    el.addEventListener("touchstart", onStart, { passive: true })
    el.addEventListener("touchmove", onMove, { passive: false })
    el.addEventListener("touchend", onEnd)
    el.addEventListener("touchcancel", onCancel)
    return () => {
      el.removeEventListener("touchstart", onStart)
      el.removeEventListener("touchmove", onMove)
      el.removeEventListener("touchend", onEnd)
      el.removeEventListener("touchcancel", onCancel)
    }
  }, [show])

  return (
    <main ref={ref} className={`scroll${className ? ` ${className}` : ""}`}>
      <div ref={arrow} className={`pull${armed ? " armed" : ""}${busy ? " busy" : ""}`} aria-live="polite">
        {busy ? (
          <>
            <span className="sr">{t("orders.refreshing")}</span>
            <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          </>
        ) : (
          <Icon name="arrow-down" size="sm" />
        )}
      </div>
      <div ref={body} className="scroll-body">
        {heading ? (
          <div className="largetitle">
            <h1>{heading.title}</h1>
            {heading.subtitle ? <p>{heading.subtitle}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </main>
  )
}
