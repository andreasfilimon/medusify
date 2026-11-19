export type MedusifyLocale = "de" | "en"

/** Plugin options as set by the merchant in `medusa-config.ts`. */
export type MedusifyPushOptions = {
  vapid?: {
    publicKey?: string
    privateKey?: string
    /** `mailto:you@example.com` or an `https://` URL. */
    subject?: string
  }
  /** Shown in the push title, e.g. "My Shop". Default: "Shop". */
  storeLabel?: string
  /** Language of push texts. Default: "de". */
  locale?: MedusifyLocale
  /** Absolute path of the PWA bundle. Default: `<plugin>/pwa-dist`. */
  pwaDir?: string
  /**
   * `true`: Medusa's own `POST /admin/orders/:id/cancel` also asks for the refund right when captured money would go
   * back, the same rule as the app's cancel route. Default `false`: Medusa's behaviour, unchanged.
   */
  strictCancelRefund?: boolean
}

export type ResolvedMedusifyPushOptions = {
  /** false ⇒ push is switched off (see `problems`), the rest of the plugin keeps working. */
  enabled: boolean
  problems: string[]
  vapid: { publicKey: string; privateKey: string; subject: string } | null
  storeLabel: string
  locale: MedusifyLocale
  pwaDir: string | null
  strictCancelRefund: boolean
}

export type PushPayload = {
  title: string
  body: string
  /**
   * `url`: where the tap leads. `kind`: see lib/push-kinds.ts. `badge`: orders still to ship in this shop, for the
   * number on the app icon (the service worker sets it). `shop`: the shop's label, so an app with several shops can add up.
   */
  data?: Record<string, unknown>
  tag?: string
}

export type SendResult = {
  sent: number
  failed: number
  removed: number
}
