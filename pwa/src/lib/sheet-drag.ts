/**
 * Where a sheet lands when the finger lets go. Pure so the rules are testable: positions are offsets of the sheet's top
 * edge from its "large" place in px (0 = fully up, `medium` = half, `closed` = off screen). The projected position adds the
 * speed of the last moment, so a quick flick goes further than a slow drag of the same length.
 */
export type SheetStops = { large: number; medium: number | null; closed: number | null }

export const PROJECTION_MS = 140

export function projected(position: number, velocityPxPerMs: number): number {
  return position + velocityPxPerMs * PROJECTION_MS
}

export function nearestStop(position: number, velocityPxPerMs: number, stops: SheetStops): "large" | "medium" | "closed" {
  const p = projected(position, velocityPxPerMs)
  const options: [("large" | "medium" | "closed"), number][] = [["large", stops.large]]
  if (stops.medium !== null) options.push(["medium", stops.medium])
  if (stops.closed !== null) options.push(["closed", stops.closed])
  let best = options[0]!
  for (const o of options) if (Math.abs(o[1] - p) < Math.abs(best[1] - p)) best = o
  return best[0]
}

/** Resistance past the ends: the sheet follows the finger fully inside its range and a fraction of the way beyond it. */
export function rubber(position: number, min: number, max: number): number {
  if (position < min) return min - (min - position) * 0.15
  if (position > max) return position
  return position
}
