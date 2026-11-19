import { createContext, useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useApp } from "../app/context"
import { nearestStop, rubber, type SheetStops } from "../lib/sheet-drag"

const SheetSlot = createContext<HTMLElement | null>(null)

/** The place right of the title, where a sheet's forward action goes. */
export function SheetAction({ label, form, disabled }: { label: string; form: string; disabled?: boolean }) {
  const slot = useContext(SheetSlot)
  return slot ? createPortal(<button type="submit" form={form} className="navbtn strong" disabled={disabled}>{label}</button>, slot) : null
}
export const useInSheet = () => useContext(SheetSlot) !== null

/** Share of the screen a tall sheet shows in its half position. */
const MEDIUM = 0.62
/** A sheet whose content is taller than this share of the screen gets a half and a full position. */
const TALL = 0.66

/**
 * Bottom sheet. Focus moves in on open and back on close. Escape, the dimmed area and a downward drag close it unless
 * `locked`: a sheet that is sending money must not go away, because a reopened one would send again under a new key.
 * Tall sheets rest in a half position and can be pulled up (or an input focused) to full height.
 */
export function Sheet({ title, onClose, locked, children, label }: { title: string; onClose(): void; locked?: boolean; children: ReactNode; label?: string }) {
  const { t } = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const returnTo = useRef<Element | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [detents, setDetents] = useState(false)
  const [detent, setDetent] = useState<"medium" | "large">("medium")
  const drag = useRef<{ id: number; y0: number; base: number; last: { t: number; y: number }[] } | null>(null)
  const lockedRef = useRef(locked)
  lockedRef.current = locked

  const offsetPx = () => Math.round(window.innerHeight * (0.92 - MEDIUM))   // how far down the half position sits
  const basePx = () => (detents && detent === "medium" ? offsetPx() : 0)

  useEffect(() => {
    returnTo.current = document.activeElement
    const first = ref.current?.querySelector<HTMLElement>("input, textarea, button:not([data-close])")
    ;(first ?? ref.current)?.focus()
    return () => {
      if (returnTo.current instanceof HTMLElement) returnTo.current.focus()
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (el && el.scrollHeight > window.innerHeight * TALL) setDetents(true)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [locked, onClose])

  const settle = (to: "large" | "medium" | "closed", px: number) => {
    const el = ref.current
    if (!el) return
    el.classList.remove("dragging")
    el.classList.add("settling")
    el.style.transform = `translateY(${px}px)`
    let done = false
    const finish = () => {
      if (done) return
      done = true
      el.removeEventListener("transitionend", finish)
      if (to === "closed") {
        onClose()
        return
      }
      setDetent(to)
      el.classList.remove("settling")
      el.style.transform = ""
    }
    el.addEventListener("transitionend", finish)
    setTimeout(finish, 800)
  }

  const onDown = (e: ReactPointerEvent) => {
    const el = ref.current
    if (!el || (e.pointerType === "mouse" && e.button !== 0)) return
    if ((e.target as HTMLElement).closest("button, a, input")) return
    drag.current = { id: e.pointerId, y0: e.clientY, base: basePx(), last: [{ t: e.timeStamp, y: e.clientY }] }
    // Capture on the element that carries the handlers (grab or head): captured events go to the capturing element, so
    // capturing the sheet itself would send move and up past the handlers.
    e.currentTarget.setPointerCapture(e.pointerId)
    el.classList.add("dragging")
  }
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current
    const el = ref.current
    if (!d || !el || d.id !== e.pointerId) return
    const top = detents ? 0 : 0
    const pos = rubber(d.base + (e.clientY - d.y0), top, Number.POSITIVE_INFINITY)
    el.style.transform = `translateY(${pos}px)`
    d.last.push({ t: e.timeStamp, y: e.clientY })
    if (d.last.length > 6) d.last.shift()
  }
  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current
    const el = ref.current
    drag.current = null
    if (!d || !el) return
    const first = d.last[0]!
    const dt = Math.max(1, e.timeStamp - first.t)
    const v = (e.clientY - first.y) / dt
    const pos = Math.max(0, d.base + (e.clientY - d.y0))
    const stops: SheetStops = { large: 0, medium: detents ? offsetPx() : null, closed: lockedRef.current ? null : el.getBoundingClientRect().height }
    const to = nearestStop(pos, v, stops)
    settle(to, to === "large" ? 0 : to === "medium" ? offsetPx() : stops.closed!)
  }

  // In body, not in the screen: the screen holds the dock and the scroll transforms, which would stack above or shift a fixed overlay.
  return createPortal(
    <div className="overlay" onClick={() => !locked && onClose()}>
      <SheetSlot.Provider value={slot}>
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-label={label ?? title}
          ref={ref}
          tabIndex={-1}
          data-detents={detents ? detent : undefined}
          style={detents ? ({ ["--detent-y" as string]: detent === "medium" ? `translateY(${offsetPx()}px)` : "none", ["--detent-pad" as string]: detent === "medium" ? `${offsetPx()}px` : "0px" }) : undefined}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => {
            if (detents && detent === "medium" && (e.target as HTMLElement).matches("input, textarea, select")) setDetent("large")
          }}
        >
          <div className="grab" aria-hidden="true" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
          <div className="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <span>
              <button className="navbtn" data-close onClick={onClose} disabled={locked}>
                {t("common.cancel")}
              </button>
            </span>
            <h2>{title}</h2>
            <span ref={setSlot} />
          </div>
          <div className="sheet-body">{children}</div>
        </div>
      </SheetSlot.Provider>
    </div>,
    document.body,
  )
}
