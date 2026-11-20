import { z } from "@medusajs/framework/zod"
import { MAX_LOW_STOCK_THRESHOLD, SWITCHABLE_KINDS } from "../../../lib/push-kinds"
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

export const PostPushPreference = z.union([
  z.object({
    endpoint: endpointSchema,
    kind: z.enum(SWITCHABLE_KINDS),
    enabled: z.boolean(),
  }),
  z.object({
    endpoint: endpointSchema,
    /** Low-stock push: at this many units or fewer this device is told. 0 = only when it is gone. */
    low_stock_threshold: z.number().int().min(0).max(MAX_LOW_STOCK_THRESHOLD),
  }),
])
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

const trackingNumber = z.string().trim().max(100)
const httpUrl = z.string().trim().max(2048).refine((u) => u === "" || /^https?:\/\/\S+$/i.test(u), { message: "must be an http(s) URL" })

export const PostShip = z.object({
  /** Send Medusa's notifications (the shop's shipping mail) or not. */
  notify: z.boolean(),
  location_id: z.string().min(1).max(128).optional(),
  /** The number of the package packed now, or of the only open package. Optional: a carrier integration may set its own. */
  tracking_number: trackingNumber.optional(),
  tracking_url: httpUrl.optional(),
  /** Numbers for packages that exist already, by fulfillment id. */
  numbers: z.record(z.string().min(1).max(128), trackingNumber).optional(),
})
export type PostShip = z.infer<typeof PostShip>

const id = z.string().min(1).max(128)
const key = z.string().min(8).max(128)

export const GetProductsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["draft", "published"]).optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type GetProductsQuery = z.infer<typeof GetProductsQuery>

export const GetLookupQuery = z.object({ code: z.string().trim().min(1).max(128) })
export type GetLookupQuery = z.infer<typeof GetLookupQuery>

export const PostPrice = z.object({
  currency_code: z.string().trim().min(3).max(3),
  /** In the currency's main unit (19.9 is 19 euro 90), as Medusa stores it. */
  amount: z.number().min(0).max(1e9),
})
export type PostPrice = z.infer<typeof PostPrice>

export const PostInventory = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("adjust"),
    inventory_item_id: id,
    location_id: id,
    quantity: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, { message: "quantity must not be 0" }),
    idempotency_key: key,
  }),
  z.object({
    mode: z.literal("set"),
    inventory_item_id: id,
    location_id: id,
    quantity: z.number().int().min(0).max(1000000),
    idempotency_key: key,
  }),
  z.object({
    /** Takes back the change an earlier request with `undo_of` made. It does nothing when that request never landed. */
    mode: z.literal("undo"),
    undo_of: key,
    idempotency_key: key,
  }),
])
export type PostInventory = z.infer<typeof PostInventory>

export const PostProduct = z.object({
  title: z.string().trim().min(1).max(200),
  status: z.enum(["draft", "published"]),
  price: z.object({ currency_code: z.string().trim().min(3).max(3), amount: z.number().min(0).max(1e9) }),
  stock: z.object({ location_id: id, quantity: z.number().int().min(0).max(1000000) }),
  /** URL of a photo already uploaded through Medusa's upload route. */
  image_url: z.string().trim().max(2048).refine((u) => /^https?:\/\/\S+$/i.test(u), { message: "must be an http(s) URL" }).optional(),
  idempotency_key: key,
})
export type PostProduct = z.infer<typeof PostProduct>
