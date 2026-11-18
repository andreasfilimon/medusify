import { useEffect, useRef, useState, type ReactNode } from "react"
import { Link, useLocation } from "wouter"
import { useApp } from "../app/context"
import { Icon, type IconName } from "./Icon"
import { Monogram } from "./kit"

export function NavBar({ title, subtitle, back, trailing, scope }: { title?: string; subtitle?: string; back?: { label: string; onClick(): void }; trailing?: ReactNode; scope?: boolean }) {
  return (
    <header className="navbar">
      <div className="navrow">
        {back ? (
          <button className="navbtn back" onClick={back.onClick}>
            <Icon name="caret-left" />
            {back.label}
          </button>
        ) : scope ? (
          <ScopeSwitcher />
        ) : (
          <span />
        )}
        {trailing ?? <span />}
      </div>
      {title ? (
        <div className="largetitle">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      ) : null}
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
  return (
    <nav className="tabbar" role="tablist" aria-label="Medusify" style={{ ["--tabs" as string]: tabs.length }}>
      {tabs.map((tab) => (
        <Link key={tab.path} className="tab" role="tab" aria-selected={active(tab.path)} href={tab.path}>
          <Icon name={active(tab.path) ? tab.iconOn : tab.icon} />
          {tab.label}
          {tab.badge ? (
            <span className="badge" aria-label={t("scope.toShip", { n: tab.badge })}>
              {tab.badge > 99 ? "99+" : tab.badge}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
