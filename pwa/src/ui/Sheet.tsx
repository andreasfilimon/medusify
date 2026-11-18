import { useEffect, useRef, type ReactNode } from "react"
import { useApp } from "../app/context"

/** Bottom sheet. Focus moves in on open and back on close; Escape and the dimmed area close it unless `locked`. */
export function Sheet({ title, onClose, locked, children, label }: { title: string; onClose(): void; locked?: boolean; children: ReactNode; label?: string }) {
  const { t } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const returnTo = useRef<Element | null>(null)

  useEffect(() => {
    returnTo.current = document.activeElement
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, button:not([data-close])")
    ;(first ?? ref.current)?.focus()
    return () => {
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [locked, onClose])

  return (
    <div className="overlay" onClick={() => !locked && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={label ?? title} ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="grab" aria-hidden="true" />
        <div className="sheet-head">
          <button className="navbtn" data-close onClick={onClose} disabled={locked}>
            {t("common.cancel")}
          </button>
          <h2>{title}</h2>
          <span />
        </div>
        {children}
      </div>
    </div>
  )
}
