/**
 * Edge swipe back. The installed app has no browser chrome, so a finger that starts at the left edge and travels right
 * goes back one page, like the back button in the bar. Only in the installed (standalone) mode: in a browser tab the
 * browser has its own gesture. Pure rule here, listener in `NavBar` (Nav.tsx).
 *
 * Not measured on a device: if iOS standalone already navigates back on its own edge swipe, both could fire. The listener
 * therefore drops its own back when a `popstate` arrived while the finger was down (the system went first).
 */
export const EDGE_ZONE = 24
export const EDGE_MIN_DX = 72
export const EDGE_MAX_SLOPE = 0.6

export type Point = { x: number; y: number }

/** True when a finger drag from `from` to `to` counts as "back": starts in the edge zone, long enough, mostly horizontal. */
export function isEdgeBack(from: Point, to: Point): boolean {
  const dx = to.x - from.x
  const dy = Math.abs(to.y - from.y)
  return from.x <= EDGE_ZONE && dx >= EDGE_MIN_DX && dy <= dx * EDGE_MAX_SLOPE
}

export function isStandalone(): boolean {
  return typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches
}
