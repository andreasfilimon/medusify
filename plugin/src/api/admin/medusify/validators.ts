import { z } from "@medusajs/framework/zod"
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
