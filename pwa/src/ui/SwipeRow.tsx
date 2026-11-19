import { useEffect, useRef, type ReactNode } from "react"
import { REVEAL, swipeEnds, swipeIntent, swipeX } from "../lib/swipe"

// Only one row stays open: opening another (or touching elsewhere) closes it.
let openRow: { close(): void } | null = null

/**
 * A row that can be pulled to the left to show one action. The row moves with a transform only, the action sits behind it.
 * Vertical movement stays with the browser's scroll (touch-action: pan-y), so a swipe never fights the list. The same action
 * is always on the detail page; the hidden button is inert while the row is closed, so keyboard and screen reader never meet it.
 */
export function SwipeRow({ children, action }: { children: ReactNode; action: { label: string; icon: ReactNode; onRun(): void } | null }) {
  const wrap = useRef<HTMLDivElement>(null)
  const front = useRef<HTMLDivElement>(null)
  const actions = useRef<HTMLDivElement>(null)
  const state = useRef({ open: false, id: -1, x0: 0, y0: 0, base: 0, mode: "undecided" as "undecided" | "swipe" | "scroll", moved: false, samples: [] as { t: number; x: number }[] })
  const run = useRef(action?.onRun)
  run.current = action?.onRun

  const set = (x: number, animate: boolean) => {
    const f = front.current
    if (!f) return
    f.style.transition = animate ? "transform var(--dur-spring-press) var(--ease-spring-press)" : "none"
    f.style.transform = x === 0 ? "" : `translateX(${x}px)`
    actions.current?.toggleAttribute("inert", x === 0 && !state.current.open)
  }
  const self = useRef({
    close() {
      state.current.open = false
      set(0, true)
      if (openRow === self.current) openRow = null
    },
  })

  useEffect(() => {
    const el = front.current
    if (!el || !action) return
    const s = state.current
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== s.id) return
      const dx = e.clientX - s.x0
      const dy = e.clientY - s.y0
      if (s.mode === "undecided") s.mode = swipeIntent(dx, dy)
      if (s.mode !== "swipe") return
      s.moved = true
      s.samples.push({ t: e.timeStamp, x: e.clientX })
      if (s.samples.length > 6) s.samples.shift()
      set(swipeX(s.base, dx), false)
    }
    const end = (e: PointerEvent) => {
      if (e.pointerId !== s.id) return
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      s.id = -1
      if (s.mode !== "swipe") return
      const first = s.samples[0]
      const last = s.samples[s.samples.length - 1]
      const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0
      const now = swipeX(s.base, e.clientX - s.x0)
      if (swipeEnds(now, v) === "open") {
        if (openRow && openRow !== self.current) openRow.close()
        s.open = true
        openRow = self.current
        set(-REVEAL, true)
      } else self.current.close()
    }
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return
      if (openRow && openRow !== self.current) openRow.close()
      s.id = e.pointerId
      s.x0 = e.clientX
      s.y0 = e.clientY
      s.base = s.open ? -REVEAL : 0
      s.mode = "undecided"
      s.moved = false
      s.samples = [{ t: e.timeStamp, x: e.clientX }]
      window.addEventListener("pointermove", onMove)
      window.addEventListener("pointerup", end)
      window.addEventListener("pointercancel", end)
    }
    // A drag ends with a click on the link under the finger; that click must not open the order. An open row closes on tap.
    const click = (e: MouseEvent) => {
      if (s.moved) {
        e.preventDefault()
        e.stopPropagation()
        s.moved = false
      } else if (s.open) {
        e.preventDefault()
        e.stopPropagation()
        self.current.close()
      }
    }
    el.addEventListener("pointerdown", down)
    el.addEventListener("click", click, true)
    return () => {
      el.removeEventListener("pointerdown", down)
      el.removeEventListener("click", click, true)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      if (openRow === self.current) openRow = null
    }
  }, [action])

  if (!action) return <>{children}</>
  return (
    <div className="swipe" ref={wrap}>
      <div className="actions" ref={actions} inert>
        <button type="button" tabIndex={-1} onClick={() => { self.current.close(); run.current?.() }}>
          {action.icon}
          {action.label}
        </button>
      </div>
      <div className="front" ref={front}>{children}</div>
    </div>
  )
}
