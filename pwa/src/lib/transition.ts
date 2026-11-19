/**
 * Page transitions with the View Transitions API. One function wraps every navigation: it picks the direction (data-vt on
 * the root element drives the CSS), names the shared element (the order title on the tapped row and in the detail) and
 * waits for the new page. Without the API, with reduced motion, or when the browser skips it, the page just changes.
 */
export type Kind = "forward" | "back" | "tab"

const BASE = "/medusify"
const TABS = new Set(["/", "/orders", "/more"])
const SHARED = "order-title"

const bare = (path: string) => {
  const p = path.split(/[?#]/)[0] ?? "/"
  const rel = p.startsWith(BASE) ? p.slice(BASE.length) : p
  return rel === "" ? "/" : rel
}

/** Between two tabs the page fades, going deeper it slides in. */
export function kindOf(from: string, to: string): Kind {
  return TABS.has(bare(from)) && TABS.has(bare(to)) ? "tab" : "forward"
}

export function transitionsOn(): boolean {
  return typeof document !== "undefined" && typeof document.startViewTransition === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches
}

// The row that was tapped, and the order it shows; the detail reads it to carry the title into its skeleton.
let tapped: { id: string; n: string | number; el: HTMLElement | null } | null = null

export function tapOrder(id: string, n: string | number, el: HTMLElement | null) {
  tapped = { id, n, el }
}

export function tappedOrder(id: string): { n: string | number } | null {
  return tapped && tapped.id === id ? { n: tapped.n } : null
}

const named = new Set<HTMLElement>()
const name = (el: HTMLElement | null | undefined) => {
  if (!el) return
  el.style.viewTransitionName = SHARED
  named.add(el)
}
const clearNames = () => {
  for (const el of named) el.style.viewTransitionName = ""
  named.clear()
}

/** The row title for an order in the list that is on screen now (after going back). */
const rowTitle = (id: string) => document.querySelector<HTMLElement>(`[data-order="${CSS.escape(id)}"] .row-title`)

/** Runs `update` (which must have rendered the new page when its promise settles) inside a transition of the given kind. */
export async function viewTransition(kind: Kind, update: () => void | Promise<void>): Promise<void> {
  if (!transitionsOn()) {
    await update()
    return
  }
  const root = document.documentElement
  root.dataset.vt = kind
  if (kind === "forward") name(tapped?.el)
  const transition = document.startViewTransition(async () => {
    await update()
    if (kind === "back" && tapped) name(rowTitle(tapped.id))
  })
  const done = () => {
    delete root.dataset.vt
    clearNames()
  }
  try {
    await transition.finished
  } catch {
    // the page changed anyway; a skipped transition is not an error
  } finally {
    done()
  }
}

/** history.back() as a promise that settles after the previous page has rendered (or after a short wait if nothing happens). */
export function backAndRender(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener("popstate", onPop)
      clearTimeout(timer)
      setTimeout(resolve, 0) // after React has flushed the location change
    }
    const onPop = () => finish()
    const timer = setTimeout(finish, 400)
    window.addEventListener("popstate", onPop)
    history.back()
  })
}
