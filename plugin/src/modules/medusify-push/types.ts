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
}

export type ResolvedMedusifyPushOptions = {
  /** false ⇒ push is switched off (see `problems`), the rest of the plugin keeps working. */
  enabled: boolean
  problems: string[]
  vapid: { publicKey: string; privateKey: string; subject: string } | null
  storeLabel: string
  locale: MedusifyLocale
  pwaDir: string | null
}

export type PushPayload = {
  title: string
  body: string
  data?: Record<string, unknown>
  tag?: string
}

export type SendResult = {
  sent: number
  failed: number
  removed: number
}
