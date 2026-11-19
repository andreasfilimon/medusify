import { useQueries, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import type { PushKindPrefs } from "../lib/api"
import { Monogram, Section } from "../ui/kit"
import { useToast } from "../ui/Toast"

const KINDS = ["canceled", "return_requested"] as const

/**
 * Which optional notifications this device gets, per shop. The setting lives in the plugin of each shop (per device and
 * shop). A shop that answers no (no subscription of this device yet, or a plugin older than 0.2.0) shows no rows.
 */
export function PushKinds() {
  const { t, shops, currentEndpoint } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const authed = shops.filter((s) => s.home || s.token)

  useEffect(() => {
    let alive = true
    void currentEndpoint().then((e) => alive && setEndpoint(e)).catch(() => {})
    return () => {
      alive = false
    }
  }, [currentEndpoint])

  const results = useQueries({
    queries: authed.map((shop) => ({
      queryKey: ["push-prefs", shop.id, endpoint],
      queryFn: () => api.getPushPreferences(shop, endpoint!),
      enabled: !!endpoint,
      retry: false,
    })),
  })

  const rows = authed.flatMap((shop, i) => (results[i]?.data ? [{ shop, prefs: results[i]!.data as PushKindPrefs }] : []))
  if (!endpoint || rows.length === 0) return null

  async function toggle(shopId: string, kind: (typeof KINDS)[number], enabled: boolean) {
    const shop = authed.find((s) => s.id === shopId)
    if (!shop || !endpoint) return
    setSaving(`${shopId}:${kind}`)
    try {
      const next = await api.setPushPreference(shop, endpoint, kind, enabled)
      qc.setQueryData(["push-prefs", shopId, endpoint], next)
    } catch {
      toast.show(t("more.pushKindFailed"), { error: true })
    } finally {
      setSaving(null)
    }
  }

  return (
    <Section id="pushkinds" title={t("more.pushKinds")}>
      {rows.map(({ shop, prefs }) => (
        <div className="group plain" key={shop.id}>
          {rows.length > 1 ? (
            <div className="row single">
              <Monogram shop={shop} small />
              <span className="row-main"><span className="row-title">{shop.name}</span></span>
            </div>
          ) : null}
          {KINDS.map((kind) => (
            <label className="row single" key={kind}>
              <span className="row-main"><span className="row-title reg">{t(`more.pushKind.${kind}`)}</span></span>
              <input type="checkbox" role="switch" checked={prefs[kind]} disabled={saving === `${shop.id}:${kind}`} onChange={(e) => void toggle(shop.id, kind, e.target.checked)} />
            </label>
          ))}
        </div>
      ))}
      <p className="foot">{t("more.pushKindsHint")}</p>
    </Section>
  )
}
