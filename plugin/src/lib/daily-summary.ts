import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { MEDUSIFY_PUSH_MODULE } from "../constants"
import type { MedusifyPushModuleService } from "../modules/medusify-push"
import { buildDashboard } from "./dashboard"
import { buildDailySummaryPayload } from "./format"
import { ADMIN_ACTIONS } from "./permissions"
import { userMay } from "./rbac"
import { isValidTimeZone, localClock } from "./time"

type Pg = { raw(sql: string, bindings: unknown[]): Promise<{ rows: { id: string }[] }> }

export type SummarySubscription = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  user_id: string
  failure_count?: number | null
  daily_summary_hour?: number | null
  daily_summary_tz?: string | null
  daily_summary_sent_on?: string | null
}

/**
 * The local day for which this device is due, or null. Due = it chose an hour, its clock shows that hour now, and that
 * day has not gone out yet. The job runs every 15 minutes, so the hour is always hit once; a backend that is down for the
 * whole hour skips that day (a summary hours late would show the wrong day's "so far").
 */
export function dueDay(sub: SummarySubscription, now: Date): string | null {
  const hour = sub.daily_summary_hour
  const tz = sub.daily_summary_tz
  if (typeof hour !== "number" || !tz || !isValidTimeZone(tz)) return null
  const clock = localClock(now, tz)
  if (clock.hour !== hour || sub.daily_summary_sent_on === clock.day) return null
  return clock.day
}

/**
 * Takes the day for this device, or finds it taken: one statement, so two backend processes running the job at the same
 * moment send only once. Returns whether this call won.
 */
async function claimDay(pg: Pg, id: string, day: string): Promise<boolean> {
  const result = await pg.raw(
    `UPDATE medusify_push_subscription SET daily_summary_sent_on = ?, updated_at = now()
     WHERE id = ? AND deleted_at IS NULL AND daily_summary_sent_on IS DISTINCT FROM ?
     RETURNING id`,
    [day, id, day]
  )
  return result.rows.length > 0
}

/** Gives the day back when its message did not go out, so the next run within the hour tries again. */
async function releaseDay(pg: Pg, id: string, day: string, before: string | null): Promise<void> {
  try {
    await pg.raw(`UPDATE medusify_push_subscription SET daily_summary_sent_on = ? WHERE id = ? AND daily_summary_sent_on = ?`, [before, id, day])
  } catch {
    /* the next day comes anyway */
  }
}

/**
 * Sends the day's numbers so far (orders, revenue per currency, orders to ship; the same numbers as the start screen)
 * to every device whose hour has come. Only users who may see the reports get it. The numbers are built once per time
 * zone. Never throws: a failing device or time zone does not stop the others.
 */
export async function sendDailySummaries(container: MedusaContainer, now = new Date()): Promise<{ sent: number; skipped: number }> {
  const service: MedusifyPushModuleService = container.resolve(MEDUSIFY_PUSH_MODULE)
  if (!service.isEnabled()) return { sent: 0, skipped: 0 }
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION) as unknown as Pg
  const config = service.getConfig()
  const all = (await service.listPushSubscriptions({ daily_summary_hour: { $ne: null } } as never, { take: null })) as SummarySubscription[]
  const mayCache = new Map<string, Promise<boolean>>()
  const may = (userId: string) => {
    if (!mayCache.has(userId)) mayCache.set(userId, userMay(container, userId, ADMIN_ACTIONS.reports).catch(() => false))
    return mayCache.get(userId)!
  }
  const numbers = new Map<string, ReturnType<typeof buildDashboard>>()
  let sent = 0
  let skipped = 0
  for (const sub of all) {
    const day = dueDay(sub, now)
    if (!day) continue
    if (!(await may(sub.user_id))) {
      skipped++
      continue
    }
    if (!(await claimDay(pg, sub.id, day))) continue
    let payload: ReturnType<typeof buildDailySummaryPayload>
    try {
      const tz = sub.daily_summary_tz!
      if (!numbers.has(tz)) numbers.set(tz, buildDashboard(container, tz, now))
      const d = await numbers.get(tz)!
      payload = buildDailySummaryPayload({ subscriptionId: sub.id, storeLabel: config.storeLabel, locale: config.locale, orders: d.today.orders, revenue: d.today.revenue, toShip: d.to_ship })
    } catch {
      // nothing was sent: the numbers could not be read, the next run tries again
      numbers.delete(sub.daily_summary_tz!)
      await releaseDay(pg, sub.id, day, sub.daily_summary_sent_on ?? null)
      continue
    }
    try {
      const failed: string[] = []
      const result = await service.sendToSubscriptions([sub], payload, failed)
      if (result.sent > 0) sent++
      else if (failed.length) await releaseDay(pg, sub.id, day, sub.daily_summary_sent_on ?? null)
    } catch {
      // the push service took the message or not, and the bookkeeping after it failed: the day stays claimed, a missed
      // summary is better than the same one twice
    }
  }
  return { sent, skipped }
}
