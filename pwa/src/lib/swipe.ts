/** Geometry of the swipe actions on an order row. Pure, so the thresholds can be tested. */
export const REVEAL = 96
/** How far ahead a flick counts: the position the finger would reach in this time at its current speed. */
const PROJECTION_MS = 140
/** The row follows the finger one to one up to the reveal width, beyond that it gives way by a quarter. */
export function swipeX(base: number, dx: number): number {
  const x = base + dx
  if (x > 0) return x * 0.2
  if (x < -REVEAL) return -REVEAL + (x + REVEAL) * 0.25
  return x
}
/** Open when the row would end up past half the reveal width; a quick flick (v in px/ms, negative = left) counts as further. */
export function swipeEnds(x: number, v: number): "open" | "closed" {
  return x + v * PROJECTION_MS < -REVEAL / 2 ? "open" : "closed"
}
/** Horizontal intent: far enough sideways and clearly more sideways than vertical, so a scroll never turns into a swipe. */
export function swipeIntent(dx: number, dy: number): "swipe" | "scroll" | "undecided" {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ay > 10 && ay > ax) return "scroll"
  if (ax > 10 && ax > ay * 1.5) return "swipe"
  return "undecided"
}
