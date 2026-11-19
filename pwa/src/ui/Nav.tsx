import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, useLocation } from "wouter"
import { useApp } from "../app/context"
import { EDGE_ZONE, isEdgeBack, isStandalone, type Point } from "../lib/edge-swipe"
import { Icon, type IconName } from "./Icon"
import { Digits, Monogram } from "./kit"

/**
 * A page with a back button also goes back on a swipe from the left edge, in the installed app only (lib/edge-swipe.ts).
 * Nothing happens while a sheet is open, and a system back that arrived during the swipe is not repeated.
 */
function useEdgeSwipeBack(onBack: (() => void) | undefined) {
  const latest = useRef(onBack)
  latest.current = onBack
  const active = !!onBack
  useEffect(() => {
    if (!active || !isStandalone()) return
    let from: Point | null = null
    let systemWentFirst = false
    const onPop = () => { systemWentFirst = true }
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      from = e.touches.length === 1 && t && t.clientX <= EDGE_ZONE && !document.querySelector(".sheet") ? { x: t.clientX, y: t.clientY } : null
      systemWentFirst = false
    }
    const onEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const start = from
      from = null
      if (start && t && !systemWentFirst && isEdgeBack(start, { x: t.clientX, y: t.clientY })) latest.current?.()
    }
    document.addEventListener("touchstart", onStart, { passive: true })
    document.addEventListener("touchend", onEnd, { passive: true })
    window.addEventListener("popstate", onPop)
    return () => {
      document.removeEventListener("touchstart", onStart)
      document.removeEventListener("touchend", onEnd)
      window.removeEventListener("popstate", onPop)
    }
  }, [active])
}

/**
 * The bar floats over the content. Its material and soft edge fade in once the content scrolls under it (Scroll.tsx
 * drives that), and the title moves up into it: `title` is the inline copy, the large one is Scroll's `heading`.
 */
export function NavBar({ title, back, trailing, scope }: { title?: string; back?: { label: string; onClick(): void }; trailing?: ReactNode; scope?: boolean }) {
  useEdgeSwipeBack(back?.onClick)
  return (
    <header className="navbar">
      <div className="navmat" aria-hidden="true" />
      <div className="navedge" aria-hidden="true" />
      <div className="navrow">
        {back ? (
          <button className="navbtn back" aria-label={back.label} onClick={back.onClick}>
            <Icon name="caret-left" />
          </button>
        ) : scope ? (
          <ScopeSwitcher />
        ) : (
          <span />
        )}
        {title ? (
          <span className="title-inline" aria-hidden="true">
            {title}
          </span>
        ) : null}
        {trailing ?? <span />}
      </div>
    </header>
  )
}

export function ScopeSwitcher() {
  const { shops, scope, setScope, t, toShip } = useApp()
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false)
        btn.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  if (shops.length < 2) return <span />
  const current = scope === "all" ? null : shops.find((s) => s.id === scope)
  const label = current ? current.name : t("scope.all")
  const stack = current ? [current] : shops.slice(0, 3)
  return (
    <>
      <button ref={btn} className="scope" aria-haspopup="menu" aria-expanded={open} aria-label={t("scope.label", { name: label })} onClick={() => setOpen(true)}>
        <span className="stack" aria-hidden="true">
          {stack.map((s) => (
            <Monogram key={s.id} shop={s} small />
          ))}
        </span>
        {label}
        <Icon name="caret-down" size="xs" />
      </button>
      {open ? (
        <div className="menu-backdrop" onClick={() => setOpen(false)}>
          <div className="popover" role="menu" onClick={(e) => e.stopPropagation()}>
            <button
              role="menuitemradio"
              aria-checked={scope === "all"}
              className="menu-item"
              onClick={() => {
                setScope("all")
                setOpen(false)
              }}
            >
              <span className="stack" aria-hidden="true">
                {shops.slice(0, 3).map((s) => (
                  <Monogram key={s.id} shop={s} small />
                ))}
              </span>
              <span className="menu-label">{t("scope.all")}</span>
              {scope === "all" ? <Icon name="check" size="sm" /> : null}
            </button>
            {shops.map((s) => (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={scope === s.id}
                className="menu-item"
                onClick={() => {
                  setScope(s.id)
                  setOpen(false)
                }}
              >
                <Monogram shop={s} small />
                <span className="menu-label">
                  {s.name}
                  {toShip[s.id] ? <small>{t("scope.toShip", { n: toShip[s.id]! })}</small> : null}
                </span>
                {scope === s.id ? <Icon name="check" size="sm" /> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

type TabDef = { path: string; icon: IconName; iconOn: IconName; label: string; badge?: number }

export function TabBar() {
  const { t, totalToShip } = useApp()
  const [location] = useLocation()
  const tabs: TabDef[] = [
    { path: "/", icon: "house", iconOn: "house-fill", label: t("tab.start") },
    { path: "/orders", icon: "receipt", iconOn: "receipt-fill", label: t("tab.orders"), badge: totalToShip },
    { path: "/more", icon: "dots-three", iconOn: "dots-three-fill", label: t("tab.more") },
  ]
  const active = (p: string) => (p === "/" ? location === "/" : location.startsWith(p))
  const index = Math.max(0, tabs.findIndex((tab) => active(tab.path)))
  return (
    <nav className="tabbar" role="tablist" aria-label="Medusify" style={{ ["--tabs" as string]: tabs.length, ["--i" as string]: index }}>
      <span className="indicator" aria-hidden="true" />
      {tabs.map((tab) => (
        <Link key={tab.path} className="tab" role="tab" aria-selected={active(tab.path)} href={tab.path}>
          <Icon name={active(tab.path) ? tab.iconOn : tab.icon} />
          {tab.label}
          {tab.badge ? (
            <span className="badge" aria-label={t("scope.toShip", { n: tab.badge })}>
              <Digits text={tab.badge > 99 ? "99+" : String(tab.badge)} />
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
