/**
 * Scroll-driven animations drive the bar material, the soft edge and the inline title. `html[data-sda]` switches the CSS
 * to that path, but only where the browser has it and the user has not asked for less motion. Everywhere else the
 * scroll position is mirrored into `data-collapsed` and `data-title` on the screen (Scroll.tsx), and CSS fades them.
 */
const NATIVE = "(animation-timeline: scroll())"

export const COLLAPSE_AT = 8
export const TITLE_AT = 52

/** Pure so it is testable: which of the two attributes a scroll position sets. */
export function collapseState(top: number): { collapsed: boolean; title: boolean } {
  return { collapsed: top > COLLAPSE_AT, title: top > TITLE_AT }
}

export function nativeScrollAnimations(): boolean {
  return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports(NATIVE) && !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)
}

let started = false
export function initScrollMode() {
  if (started || typeof document === "undefined") return
  started = true
  const apply = () => {
    if (nativeScrollAnimations()) document.documentElement.dataset.sda = ""
    else delete document.documentElement.dataset.sda
  }
  apply()
  if (typeof matchMedia === "function") matchMedia("(prefers-reduced-motion: reduce)").addEventListener?.("change", apply)
}

/** Test hook: forget the one-time setup so a test can start again with another browser. */
export function resetScrollModeForTest() {
  started = false
  delete document.documentElement.dataset.sda
}
