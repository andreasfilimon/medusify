import { useQueries, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import type { PushPrefs } from "../lib/api"
import { Monogram, Section } from "../ui/kit"
import { Stepper } from "../ui/Stepper"
import { useToast } from "../ui/Toast"

const KINDS = ["canceled", "return_requested", "low_stock"] as const
type Kind = (typeof KINDS)[number]

/** A tap on the stepper is saved this long after the last tap, so five taps are one request. */
const THRESHOLD_SAVE_MS = 700
export const MAX_THRESHOLD = 9999

/**
 * Which optional notifications this device gets, per shop. The setting lives in the plugin of each shop (per device and
 * shop). A shop that answers no (no subscription of this device yet, or a plugin older than 0.2.0) shows no rows; one that
 * is older than 0.3.0 shows no low-stock row.
 */
export function PushKinds() {
  const { t, shops, currentEndpoint } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  // The number the stepper shows while its save is on the way; the shop's answer takes over afterwards.
  const [typed, setTyped] = useState<Record<string, number>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const authed = shops.filter((s) => s.home || s.token)

  useEffect(() => {
    let alive = true
    void currentEndpoint().then((e) => alive && setEndpoint(e)).catch(() => {})
    return () => {
      alive = false
    }
  }, [currentEndpoint])
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  const results = useQueries({
    queries: authed.map((shop) => ({
      queryKey: ["push-prefs", shop.id, endpoint],
      queryFn: () => api.getPushPreferences(shop, endpoint!),
      enabled: !!endpoint,
      retry: false,
    })),
  })

  const rows = authed.flatMap((shop, i) => (results[i]?.data ? [{ shop, prefs: results[i]!.data as PushPrefs }] : []))
  if (!endpoint || rows.length === 0) return null

  async function toggle(shopId: string, kind: Kind, enabled: boolean) {
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

  function changeThreshold(shopId: string, value: number) {
    const shop = authed.find((s) => s.id === shopId)
    if (!shop || !endpoint) return
    setTyped((prev) => ({ ...prev, [shopId]: value }))
    clearTimeout(timers.current[shopId])
    timers.current[shopId] = setTimeout(async () => {
      try {
        const next = await api.setLowStockThreshold(shop, endpoint, value)
        qc.setQueryData(["push-prefs", shopId, endpoint], next)
      } catch {
        toast.show(t("more.pushKindFailed"), { error: true })
        void qc.invalidateQueries({ queryKey: ["push-prefs", shopId, endpoint] })
      } finally {
        setTyped(({ [shopId]: _gone, ...rest }) => rest)
      }
    }, THRESHOLD_SAVE_MS)
  }

  return (
    <Section id="pushkinds" title={t("more.pushKinds")}>
      {rows.map(({ shop, prefs }) => {
        const hasLowStock = prefs.low_stock_threshold >= 0
        const threshold = typed[shop.id] ?? prefs.low_stock_threshold
        return (
          <div className="group plain" key={shop.id}>
            {rows.length > 1 ? (
              <div className="row single">
                <Monogram shop={shop} small />
                <span className="row-main"><span className="row-title">{shop.name}</span></span>
              </div>
            ) : null}
            {KINDS.filter((k) => k !== "low_stock" || hasLowStock).map((kind) => (
              <label className="row single" key={kind}>
                <span className="row-main"><span className="row-title reg">{t(`more.pushKind.${kind}`)}</span></span>
                <input type="checkbox" role="switch" checked={prefs.kinds[kind]} disabled={saving === `${shop.id}:${kind}`} onChange={(e) => void toggle(shop.id, kind, e.target.checked)} />
              </label>
            ))}
            {hasLowStock && prefs.kinds.low_stock ? (
              <div className="row single">
                <span className="row-main"><span className="row-title reg">{t("more.lowStockFrom")}</span></span>
                <Stepper value={threshold} max={MAX_THRESHOLD} onChange={(n) => changeThreshold(shop.id, n)} label={t("more.lowStockFrom")} />
              </div>
            ) : null}
          </div>
        )
      })}
      <p className="foot">{t("more.pushKindsHint")}</p>
      {rows.some((r) => r.prefs.low_stock_threshold >= 0 && r.prefs.kinds.low_stock) ? <p className="foot">{t("more.lowStockHint")}</p> : null}
    </Section>
  )
}
