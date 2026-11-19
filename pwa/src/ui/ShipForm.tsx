import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { cleanTrackingNumber } from "../lib/format"
import { startScan, type ScanHandle } from "../lib/scan"
import type { Order, Shop } from "../lib/types"
import { Icon } from "./Icon"
import { FieldError } from "./kit"
import { SheetAction, useInSheet } from "./Sheet"
import { useToast } from "./Toast"

type Camera = "starting" | "on" | "denied" | "none"

const URL_OK = /^https?:\/\/\S+$/i

/**
 * Tracking number capture: camera scan with typed input as the fallback, then "Als versendet markieren".
 * The camera opens only here, which the user reached with a tap on "Versenden".
 */
export function ShipForm({ shop, order, onDone }: { shop: Shop; order: Order; onDone(): void }) {
  const { t, online } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const video = useRef<HTMLVideoElement>(null)
  const handle = useRef<ScanHandle | null>(null)
  const pending = useRef(false)
  const [camera, setCamera] = useState<Camera>("starting")
  const [tracking, setTracking] = useState("")
  const [detected, setDetected] = useState(false)
  const [url, setUrl] = useState("")
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errId = useId()
  const formId = useId()
  const inSheet = useInSheet()
  const locationId = useId()
  const [chosenLocation, setChosenLocation] = useState<string | null>(null)
  // Where the goods leave from. One location needs no question; with several the user picks, the first one is preselected.
  const locations = useQuery({ queryKey: ["ship-locations", shop.id, order.id], queryFn: () => api.fulfillmentLocations(shop, order), staleTime: 5 * 60_000 })
  const choices = locations.data ?? []
  const location = chosenLocation && choices.some((l) => l.id === chosenLocation) ? chosenLocation : choices[0]?.id

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!video.current) return
      const res = await startScan(video.current, (value) => {
        setTracking(value)
        setDetected(true)
      })
      if (!alive) {
        if (res.kind === "started") res.handle.stop()
        return
      }
      if (res.kind === "started") {
        handle.current = res.handle
        setCamera("on")
      } else setCamera(res.kind === "denied" ? "denied" : "none")
    })()
    return () => {
      alive = false
      handle.current?.stop()
      handle.current = null
    }
  }, [])

  const off = camera === "none" || camera === "denied"
  const number = cleanTrackingNumber(tracking)
  const urlBad = url.trim() !== "" && !URL_OK.test(url.trim())

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending.current || !number || urlBad) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await api.shipOrder(shop, order, { tracking_number: number, tracking_url: url.trim() || undefined, notify, location_id: location })
      handle.current?.stop()
      await Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })])
      toast.show(t("ship.done"))
      onDone()
    } catch (err) {
      // The fulfillment may exist already (the shipment is the step that failed): the stock location is then fixed.
      void qc.invalidateQueries({ queryKey: ["ship-locations"] })
      const failure = api.shipFailure(err)
      if (failure.kind === "unknown") {
        // The shop may have created the shipment before the connection broke: read the order again so the screen shows the truth.
        void Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })])
        setError(t("ship.failedUnknown"))
      } else if (failure.kind === "auth") setError(t("ship.failedAuth"))
      else setError(t("ship.failed", { reason: failure.reason ?? t("ship.failedGeneric") }))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <form className="form ship" id={formId} onSubmit={submit} noValidate>
      {off ? (
        <p className="cam-off">
          <Icon name="camera" size="sm" />
          {t("ship.cameraOff")}
        </p>
      ) : null}
      <div className="viewfinder" hidden={off} aria-label={t("ship.hint")}>
        <video ref={video} muted playsInline />
        <span className="frame" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="hint">{camera === "starting" ? t("ship.starting") : t("ship.hint")}</span>
      </div>
      <label className="field">
        <span>{t("ship.tracking")}</span>
        <input
          type="text"
          name="tracking"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="go"
          value={tracking}
          onChange={(e) => {
            setTracking(e.target.value)
            setDetected(false)
          }}
          aria-describedby={error ? errId : undefined}
        />
        {detected ? <small className="help"><Icon name="check-circle" size="xs" />{t("ship.detected")}</small> : null}
      </label>
      <label className="field">
        <span>{t("ship.trackingUrl")}</span>
        <input type="url" name="tracking-url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="go" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={urlBad} />
        {urlBad ? <small className="help bad"><Icon name="warning-circle" size="xs" />{t("ship.invalidUrl")}</small> : null}
      </label>
      {choices.length > 1 ? (
        <div className="field select">
          <label htmlFor={locationId}>{t("ship.location")}</label>
          <select id={locationId} name="location" value={location} onChange={(e) => setChosenLocation(e.target.value)}>
            {choices.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <Icon name="caret-down" size="xs" />
        </div>
      ) : null}
      <button type="button" className="switch" role="switch" aria-checked={notify} onClick={() => setNotify((v) => !v)}>
        <span>{t("ship.notify")}</span>
        <span className="track" aria-hidden="true" />
      </button>
      {error ? <FieldError id={errId}>{error}</FieldError> : null}
      {!online ? <FieldError id={errId}>{t("ship.offline")}</FieldError> : null}
      {inSheet ? (
        <SheetAction label={t("ship.confirm")} form={formId} disabled={busy || !number || urlBad || !online} />
      ) : (
        <button className="btn primary form-submit" type="submit" disabled={busy || !number || urlBad || !online}>
          {t("ship.confirm")}
        </button>
      )}
    </form>
  )
}
