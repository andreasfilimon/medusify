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
  }
)

export default PushSubscription
