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
export function ShipForm({ shop, order, onDone, onBusyChange }: { shop: Shop; order: Order; onDone(): void; onBusyChange?(busy: boolean): void }) {
  const { t, online } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const video = useRef<HTMLVideoElement>(null)
  const handle = useRef<ScanHandle | null>(null)
  const pending = useRef(false)
  const [camera, setCamera] = useState<Camera>("starting")
  const [tracking, setTracking] = useState("")
  const [detected, setDetected] = useState(false)
  // Once the user typed, the camera no longer writes into the field (it kept replacing a corrected number).
  const typed = useRef(false)
  const [numbers, setNumbers] = useState<Record<string, string>>({})
  const [url, setUrl] = useState("")
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const errId = useId()
  const formId = useId()
  const inSheet = useInSheet()
  const locationId = useId()
  const [chosenLocation, setChosenLocation] = useState<string | null>(null)
  // Where the goods leave from (one location needs no question; with several the user picks, the first one is
  // preselected) and the packages packed earlier, with the numbers a carrier integration gave them.
  const plan = useQuery({ queryKey: ["ship-locations", shop.id, order.id], queryFn: () => api.shipPlan(shop, order), staleTime: 5 * 60_000 })
  const perms = useQuery({ queryKey: ["permissions", shop.id], queryFn: () => api.getPermissions(shop), staleTime: 5 * 60_000, retry: false })
  const mayShip = perms.data?.ship !== false
  const choices = plan.data?.locations ?? []
  const packages = plan.data?.packages ?? []
  const labelled = packages.filter((p) => p.labels.length > 0)
  // The main field is the number of the package packed now; with nothing to pack, of the only package packed earlier.
  // Every other package packed earlier without a number gets a field of its own.
  const mainFor = plan.data && !plan.data.packsNew && packages.length === 1 ? packages[0] : undefined
  // Several packages waiting and nothing new to pack: one number cannot belong to all, each gets its own field.
  const mainHidden = !!plan.data && !plan.data.packsNew && packages.length > 1
  const extra = plan.data ? packages.filter((p) => p !== mainFor && p.labels.length === 0) : []
  // Where a scanned number goes: the main field, or with the main field hidden the first empty package field.
  const scanInto = useRef<(value: string) => void>(() => {})
  scanInto.current = (value) => {
    if (!mainHidden) {
      if (typed.current) return
      setTracking(value)
      setDetected(true)
      return
    }
    const empty = extra.find((p) => !numbers[p.id]?.trim())
    if (empty && !Object.values(numbers).includes(value)) setNumbers((prev) => ({ ...prev, [empty.id]: value }))
  }
  const location = chosenLocation && choices.some((l) => l.id === chosenLocation) ? chosenLocation : choices[0]?.id

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!video.current) return
      const res = await startScan(video.current, (value) => scanInto.current(value))
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
    if (pending.current || urlBad || !mayShip) return
    pending.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError(null)
    const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })])
    try {
      const cleaned = Object.fromEntries(extra.map((p) => [p.id, cleanTrackingNumber(numbers[p.id] ?? "")]).filter(([, v]) => v))
      const outcome = await api.shipOrder(shop, order, { tracking_number: mainHidden ? undefined : number || undefined, tracking_url: url.trim() || undefined, notify, location_id: location, numbers: cleaned })
      handle.current?.stop()
      await refresh()
      toast.show(outcome?.unusedNumber ? t("ship.doneNumberUnused") : t("ship.done"))
      onDone()
    } catch (err) {
      // Part of the work may be done (a package packed, a shipment registered): the screen reads the order again in
      // every case, and the stock location of a package that exists is fixed.
      void qc.invalidateQueries({ queryKey: ["ship-locations"] })
      void refresh()
      const failure = api.shipFailure(err)
      if (failure.kind === "unknown") setError(t("ship.failedUnknown"))
      else if (failure.kind === "numbers") setError(t("ship.numbersRequired"))
      else if (failure.kind === "auth") setError(t("ship.failedAuth"))
      else setError(t("ship.failed", { reason: failure.reason ?? t("ship.failedGeneric") }))
    } finally {
      pending.current = false
      setBusy(false)
      onBusyChange?.(false)
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
      {mainHidden ? null : (
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
              // An emptied field takes the camera's number again.
              typed.current = e.target.value.trim() !== ""
            }}
            aria-describedby={error ? errId : undefined}
          />
          {detected ? <small className="help"><Icon name="check-circle" size="xs" />{t("ship.detected")}</small> : null}
        </label>
      )}
      {!mainHidden && !number && labelled.length === 0 && plan.data ? <p className="help ship-labels">{t("ship.noNumber")}</p> : null}
      {labelled.length > 0 ? (
        <p className="help ship-labels">
          <Icon name="check-circle" size="xs" />
          {t("ship.carrierLabel", { numbers: labelled.flatMap((p) => p.labels).join(", ") })}
        </p>
      ) : null}
      {extra.map((p, n) => (
        <label className="field" key={p.id}>
          <span>{t("ship.packedBefore", { n: n + 1 })}</span>
          <input
            type="text"
            name={`tracking-${p.id}`}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            value={numbers[p.id] ?? ""}
            onChange={(e) => setNumbers((prev) => ({ ...prev, [p.id]: e.target.value }))}
          />
        </label>
      ))}
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
      {!mayShip ? <FieldError id={errId}>{t("ship.notAllowed")}</FieldError> : null}
      {error ? <FieldError id={errId}>{error}</FieldError> : null}
      {!online ? <FieldError id={errId}>{t("ship.offline")}</FieldError> : null}
      {inSheet ? (
        <SheetAction label={t("ship.confirm")} form={formId} disabled={busy || urlBad || !online || !mayShip} />
      ) : (
        <button className="btn primary form-submit" type="submit" disabled={busy || urlBad || !online || !mayShip}>
          {t("ship.confirm")}
        </button>
      )}
    </form>
  )
}
