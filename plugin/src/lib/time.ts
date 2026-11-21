/** Time zone helpers without a date library: boundaries of "today" / "this month" in a given IANA zone. */

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function zoneParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  }
}

/** Offset of the zone at the given instant (zone time minus UTC), in ms. */
function offsetMs(date: Date, tz: string): number {
  const p = zoneParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/** The UTC instant at which the wall clock in `tz` reads y-m-d 00:00:00. */
export function zonedMidnightToUtc(
  year: number,
  month: number,
  day: number,
  tz: string
): Date {
  let utc = Date.UTC(year, month - 1, day)
  const off1 = offsetMs(new Date(utc), tz)
  utc -= off1
  const off2 = offsetMs(new Date(utc), tz)
  if (off2 !== off1) {
    utc += off1 - off2
  }
  return new Date(utc)
}

export function dayAndMonthStart(now: Date, tz: string) {
  const p = zoneParts(now, tz)
  return {
    todayStart: zonedMidnightToUtc(p.year, p.month, p.day, tz),
    monthStart: zonedMidnightToUtc(p.year, p.month, 1, tz),
  }
}

/** The wall clock in `tz` at `date`: the day as YYYY-MM-DD and the hour (0–23). */
export function localClock(date: Date, tz: string): { day: string; hour: number } {
  const p = zoneParts(date, tz)
  return { day: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, hour: p.hour }
}
