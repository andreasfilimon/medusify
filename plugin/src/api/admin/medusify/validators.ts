import { z } from "@medusajs/framework/zod"
import { SWITCHABLE_KINDS } from "../../../lib/push-kinds"
import { isValidTimeZone } from "../../../lib/time"

const endpointSchema = z
  .url()
  .max(2048)
  .refine((u) => u.startsWith("https://"), { message: "endpoint must be an https URL" })

const base64Url = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+={0,2}$/, "must be url-safe base64")

export const PostPushSubscription = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: base64Url,
    auth: base64Url,
  }),
  user_agent: z.string().max(512).optional(),
})
export type PostPushSubscription = z.infer<typeof PostPushSubscription>

export const DeletePushSubscription = z.object({
  endpoint: endpointSchema,
})
export type DeletePushSubscription = z.infer<typeof DeletePushSubscription>

export const GetDashboardQuery = z.object({
  tz: z
    .string()
    .max(64)
    .refine(isValidTimeZone, { message: "tz must be an IANA time zone, e.g. Europe/Vienna" })
    .default("UTC"),
})
export type GetDashboardQuery = z.infer<typeof GetDashboardQuery>

export const GetPushPreferencesQuery = z.object({ endpoint: endpointSchema })
export type GetPushPreferencesQuery = z.infer<typeof GetPushPreferencesQuery>

export const PostPushPreference = z.object({
  endpoint: endpointSchema,
  kind: z.enum(SWITCHABLE_KINDS),
  enabled: z.boolean(),
})
export type PostPushPreference = z.infer<typeof PostPushPreference>

export const PostReturn = z.object({
  order_id: z.string().min(1).max(128),
  items: z
    .array(z.object({ id: z.string().min(1).max(128), quantity: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(200),
  /** Money to give back right away; checked against what is still refundable before anything is written. */
  refund_amount: z.number().positive().max(1e9).optional(),
  note: z.string().max(500).optional(),
  /** One per attempt, made by the app and sent again unchanged on a retry: the second request is not a second return. */
  idempotency_key: z.string().min(8).max(128).optional(),
})
export type PostReturn = z.infer<typeof PostReturn>
