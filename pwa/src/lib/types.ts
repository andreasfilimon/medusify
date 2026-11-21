export type ShopColor = 1 | 2 | 3 | 4 | 5 | 6

export type Shop = {
  /** Stable id: the normalised origin, e.g. "https://shop.example.com" or "http://localhost:9055". */
  id: string
  /** Origin including scheme, no path. */
  url: string
  name: string
  color: ShopColor
  /** The origin the app was loaded from. Uses the cookie session; everything else uses a bearer token. */
  home: boolean
  /** Bearer JWT. Only set for foreign shops; the home shop keeps its session in an httpOnly cookie. */
  token?: string
  /** True once this device is registered for push at this shop. */
  pushRegistered?: boolean
  /** Last push registration error for this shop, shown in More. */
  pushError?: string
}

export type Money = { currency_code: string; amount: number }

export type DashboardOrder = {
  id: string
  display_id: number
  created_at: string
  currency_code: string
  total: number
  status: string
  payment_status: string
  fulfillment_status: string
  country_code: string | null
  item_count: number
  /** Some line has units that are neither shipped nor delivered (plugin 0.2.2 and later; see `unsentRest`). */
  unsent_rest?: boolean
}

export type Dashboard = {
  /** The shop's label as the plugin writes it into push titles. Lets the service worker match a push to a shop. */
  shop_label?: string
  timezone: string
  generated_at: string
  today: { orders: number; revenue: Money[] }
  month: { orders: number; revenue: Money[] }
  to_ship: number
  recent_orders: DashboardOrder[]
}

export type OrderItem = {
  /** False for goods without shipping (a voucher, a download): they get no parcel. */
  requires_shipping?: boolean | null
  id: string
  title: string
  /** The variant the line was sold as; null for a line without one (a custom line) or a deleted variant. */
  variant_id?: string | null
  product_title?: string | null
  variant_title?: string | null
  quantity: number
  unit_price: number
  total: number
  thumbnail?: string | null
  detail?: {
    fulfilled_quantity?: number
    shipped_quantity?: number
    delivered_quantity?: number
    return_requested_quantity?: number
    return_received_quantity?: number
    return_dismissed_quantity?: number
    /** Units a claim took back as refunded (Medusa's write-off): the order total stays, this count moves. */
    written_off_quantity?: number
  }
  /** Only the inventory links are read, for the quantity of a kit line in a fulfillment. `null` when the variant was deleted. */
  variant?: { inventory_items?: { inventory_item_id?: string | null; required_quantity?: number | null }[] } | null
}

export type Address = {
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  address_1?: string | null
  address_2?: string | null
  postal_code?: string | null
  city?: string | null
  province?: string | null
  country_code?: string | null
  phone?: string | null
}

export type Payment = {
  id: string
  provider_id?: string
  captured_at?: string | null
  canceled_at?: string | null
  amount?: number
  captures?: { amount?: number }[] | null
  refunds?: { amount?: number }[] | null
}

export type PaymentCollection = { id: string; status?: string; payments?: Payment[] }

export type Order = {
  id: string
  display_id: number
  status: string
  created_at: string
  email?: string | null
  customer_id?: string | null
  currency_code: string
  payment_status: string
  fulfillment_status: string
  total: number
  /** Medusa counts every confirmed change (edit, exchange, claim, return) up by one. */
  version?: number
  subtotal?: number
  item_total?: number
  shipping_total?: number
  tax_total?: number
  items?: OrderItem[]
  shipping_address?: Address | null
  sales_channel_id?: string | null
  shipping_methods?: { name?: string | null; shipping_option_id?: string | null }[]
  fulfillments?: {
    id: string
    created_at?: string
    shipped_at?: string | null
    delivered_at?: string | null
    canceled_at?: string | null
    location_id?: string | null
    requires_shipping?: boolean | null
    items?: { line_item_id: string; inventory_item_id?: string | null; quantity: number }[]
    labels?: { tracking_number?: string | null; tracking_url?: string | null; label_url?: string | null }[]
  }[]
  payment_collections?: PaymentCollection[]
}

/** An order together with the shop it came from. The list in "Alle Shops" is a list of these. */
export type ShopOrder<T = Order> = { shop: Shop; order: T }
