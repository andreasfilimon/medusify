import { model } from "@medusajs/framework/utils"

/**
 * One Web Push subscription of one admin device.
 * Table name is prefixed so it cannot collide with other plugins in a shared database.
 * created_at / updated_at / deleted_at are added by Medusa.
 */
const PushSubscription = model.define(
  { name: "PushSubscription", tableName: "medusify_push_subscription" },
  {
    id: model.id({ prefix: "cpush" }).primaryKey(),
    endpoint: model.text().unique(),
    p256dh: model.text(),
    auth: model.text(),
    user_id: model.text().index(),
    user_agent: model.text().nullable(),
    last_success_at: model.dateTime().nullable(),
    failure_count: model.number().default(0),
    /** Push kinds this device has switched off (see lib/push-kinds.ts). Empty = everything on. */
    disabled_kinds: model.array().default([]),
    /** Low-stock push: this device is told when a variant's stock falls to this number or below (see lib/low-stock.ts). */
    low_stock_threshold: model.number().default(5),
    /**
     * Daily summary push: the hour (0–23, on the device's clock) at which this device gets the day's numbers, and the
     * time zone of that clock. Null = off (the default). `daily_summary_sent_on` is the local day it last went out
     * (YYYY-MM-DD), so a day is never sent twice (see lib/daily-summary.ts).
     */
    daily_summary_hour: model.number().nullable(),
    daily_summary_tz: model.text().nullable(),
    daily_summary_sent_on: model.text().nullable(),
  }
)

export default PushSubscription
