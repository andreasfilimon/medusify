import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import { ALL_ALLOWED } from "../lib/actions"
import * as api from "../lib/api"
import { editableInventory, variantLabel, MAX_STOCK, type LookupMatch } from "../lib/catalog"
import { catalogErrorText } from "../lib/catalog-text"
import { goBack } from "../lib/nav"
import { cleanProductCode, startScan, type ScanHandle } from "../lib/scan"
import { OPEN_GATE, addedByVariant, admit, lastUndoable, patchEntry, upsertEntry, tallyAdd, tallyRemove, tallySet, tallyWritten, totalAdded, type Entry, type Mode, type Tally } from "../lib/scan-session"
import { AssignSheet } from "../ui/AssignSheet"
import { Icon } from "../ui/Icon"
import { Digits, Empty, FieldError, Section, Segmented } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { PickSheet } from "../ui/PickSheet"
import { Scroll } from "../ui/Scroll"
import { Stepper } from "../ui/Stepper"
import { useToast } from "../ui/Toast"

type CameraState = "starting" | "on" | "none" | "denied"
type Sheet = { kind: "unknown"; code: string } | { kind: "choose"; matches: LookupMatch[] } | { kind: "place"; match: LookupMatch }

const title = (m: LookupMatch) => m.product.title
const vtitle = (m: LookupMatch) => variantLabel(m.variant, m.product.title)

/**
 * Scanner mode: the camera reads a product code, the shop finds the variant, and the scan books one unit ("+1 pro Scan",
 * each with an undo) or counts it up in a list that is written when the user applies it ("Zählen"). Every write carries a key
 * of its own, so a lost answer is sent again as the same request. An unknown code can be assigned to a product on the spot.
 */
export function Scanner({ shopId }: { shopId: string }) {
  const { t, shops, online } = useApp()
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const toast = useToast()
  const shop = shops.find((s) => s.id === shopId && (s.home || s.token))
  const perms = useQuery({ queryKey: ["permissions", shopId], queryFn: () => api.getPermissions(shop!), enabled: !!shop, staleTime: 5 * 60_000, retry: false })
  const allowed = perms.data ?? ALL_ALLOWED
  const places = useQuery({ queryKey: ["locations", shopId], queryFn: () => api.stockLocations(shop!), enabled: !!shop, staleTime: 5 * 60_000 })
  const [mode, setMode] = useState<Mode>("plus")
  const [place, setPlace] = useState("")
  const [entries, setEntries] = useState<Entry[]>([])
  const [tally, setTally] = useState<Tally>(new Map())
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [camera, setCamera] = useState<CameraState>("starting")
  const [typed, setTyped] = useState("")
  const [applyBusy, setApplyBusy] = useState(false)
  const [tallyErrors, setTallyErrors] = useState<Record<string, string>>({})
  const [undoing, setUndoing] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const handle = useRef<ScanHandle | null>(null)
  const gate = useRef(OPEN_GATE)
  const sheetOpen = useRef(false)
  const modeRef = useRef(mode)
  const placeRef = useRef(place)
  const locations = places.data ?? []
  modeRef.current = mode
  placeRef.current = place
  sheetOpen.current = sheet !== null
  const formId = useId()
  const tallyKeys = useRef(new Map<string, string>())

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["product"] }), qc.invalidateQueries({ queryKey: ["products"] })])

  /** Where a scan books to: the chosen place, the only place, or the only place the variant has; otherwise the user is asked. */
  function placeFor(m: LookupMatch): string | null {
    const inv = editableInventory(m.variant)
    if (!inv) return null
    if (placeRef.current) return placeRef.current
    if (locations.length === 1) return locations[0]!.id
    if (inv.levels.length === 1) return inv.levels[0]!.location_id
    return null
  }

  async function send(entry: Entry) {
    if (!shop) return
    setEntries((p) => upsertEntry(p, entry))
    try {
      const a = await api.changeStock(shop, { mode: "adjust", inventory_item_id: entry.inventoryItemId, location_id: entry.locationId, quantity: 1, idempotency_key: entry.key })
      setEntries((p) => patchEntry(p, entry.key, { status: "done", stocked: a.stocked, error: null }))
      void refresh()
    } catch (err) {
      setEntries((p) => patchEntry(p, entry.key, { status: "failed", error: catalogErrorText(t, err).text }))
    }
  }

  function apply(m: LookupMatch, chosenPlace?: string) {
    const inv = editableInventory(m.variant)
    if (!inv) {
      toast.show(t(m.variant.stock_total === null ? "scan.notTracked" : "scan.notCountable", { name: title(m) }), { error: true })
      return
    }
    const loc = chosenPlace ?? placeFor(m)
    if (!loc) {
      setSheet({ kind: "place", match: m })
      return
    }
    const level = inv.levels.find((l) => l.location_id === loc)
    if (modeRef.current === "plus") {
      void send({ key: crypto.randomUUID(), variantId: m.variant.id, inventoryItemId: inv.inventory_item_id, locationId: loc, productTitle: title(m), variantTitle: vtitle(m), stocked: null, status: "sending", undone: false, undoKey: null })
    } else {
      setTally((p) => tallyAdd(p, { variantId: m.variant.id, inventoryItemId: inv.inventory_item_id, locationId: loc, productTitle: title(m), variantTitle: vtitle(m), was: level ? level.stocked : null }))
    }
  }

  async function lookup(raw: string) {
    const code = cleanProductCode(raw)
    if (!shop || !code) return
    try {
      const matches = await api.lookupVariants(shop, code)
      if (matches.length === 0) setSheet({ kind: "unknown", code })
      else if (matches.length === 1) apply(matches[0]!)
      else setSheet({ kind: "choose", matches })
    } catch (err) {
      toast.show(catalogErrorText(t, err).text, { error: true })
    }
  }
  const lookupRef = useRef(lookup)
  lookupRef.current = lookup

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!video.current) return
      const res = await startScan(
        video.current,
        (code) => {
          const r = admit(gate.current, code, Date.now())
          gate.current = r.gate
          if (r.accept && !sheetOpen.current) void lookupRef.current(code)
        },
        "product",
      )
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

  async function undo(entry: Entry) {
    if (!shop || undoing) return
    const key = entry.undoKey ?? crypto.randomUUID()
    setEntries((p) => patchEntry(p, entry.key, { undoKey: key }))
    setUndoing(entry.key)
    try {
      const a = await api.changeStock(shop, { mode: "undo", undo_of: entry.key, idempotency_key: key })
      setEntries((p) => patchEntry(p, entry.key, { undone: true, stocked: a.stocked }))
      void refresh()
    } catch (err) {
      const f = catalogErrorText(t, err)
      // A clear refusal ends this take-back; a lost answer keeps the key, so the next tap is the same request.
      if (!f.unknown) setEntries((p) => patchEntry(p, entry.key, { undoKey: null }))
      toast.show(f.text, { error: true })
    } finally {
      setUndoing(null)
    }
  }

  async function applyTally() {
    if (!shop || applyBusy) return
    setApplyBusy(true)
    setTallyErrors({})
    const errors: Record<string, string> = {}
    let done = 0
    // The camera keeps scanning while the counts are written: a row is only taken off when its count is still the one that
    // was written, and the rows are read from the state, never from a copy taken before the writing.
    for (const row of [...tally.values()]) {
      const content = `${row.inventoryItemId}|${row.locationId}|${row.counted}`
      let key = tallyKeys.current.get(content)
      if (!key) {
        key = crypto.randomUUID()
        tallyKeys.current.set(content, key)
      }
      try {
        await api.changeStock(shop, { mode: "set", inventory_item_id: row.inventoryItemId, location_id: row.locationId, quantity: row.counted, idempotency_key: key })
        tallyKeys.current.delete(content)
        setTally((p) => tallyWritten(p, row.key, row.counted))
        done++
      } catch (err) {
        const f = catalogErrorText(t, err)
        if (!f.unknown) tallyKeys.current.delete(content)
        errors[row.key] = f.text
      }
    }
    setTallyErrors(errors)
    setApplyBusy(false)
    void refresh()
    if (done > 0) toast.show(t("scan.applied", { n: done }))
  }

  function typedSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    const code = typed
    setTyped("")
    void lookup(code)
  }

  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/products") }
  const off = camera === "none" || camera === "denied"
  const added = addedByVariant(entries)
  const last = lastUndoable(entries)
  const rows = [...entries].reverse()
  const tallyRows = [...tally.values()]

  if (shop && perms.data && (!allowed.catalog || !allowed.stock)) {
    return (
      <div className="screen">
        <NavBar back={back} title={t("scan.title")} />
        <Scroll heading={{ title: t("scan.title") }}><Empty icon="lock-simple" title={t("prod.forbiddenTitle")} text={t("scan.noRight")} /></Scroll>
      </div>
    )
  }

  return (
    <div className="screen">
      <NavBar back={back} title={t("scan.title")} />
      <Scroll heading={{ title: t("scan.title"), subtitle: shop && shops.length > 1 ? shop.name : undefined }}>
        <div className="scan-controls">
          <Segmented<Mode> value={mode} label={t("scan.mode")} onChange={setMode} options={[{ value: "plus", label: t("scan.modePlus") }, { value: "count", label: t("scan.modeCount") }]} />
          {locations.length > 1 ? (
            <label className="field inline">
              <span>{t("scan.place")}</span>
              <select value={place} onChange={(e) => setPlace(e.target.value)}>
                <option value="">{t("scan.placeAuto")}</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        {off ? <p className="cam-off"><Icon name="camera" size="sm" />{t("scan.cameraOff")}</p> : null}
        <div className="viewfinder tall" hidden={off} aria-label={t("scan.hint")}>
          <video ref={video} muted playsInline />
          <span className="frame" aria-hidden="true"><i /><i /><i /><i /></span>
          <span className="hint">{camera === "starting" ? t("ship.starting") : t("scan.hint")}</span>
        </div>
        <form className="form scan-type" id={formId} onSubmit={typedSubmit} noValidate>
          <label className="field">
            <span>{t("scan.typeCode")}</span>
            <span className="field-box">
              <input type="text" name="code" inputMode="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="go" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="submit" className="addon" disabled={!typed.trim() || !online}>{t("scan.lookup")}</button>
            </span>
          </label>
        </form>

        {mode === "plus" ? (
          <Section id="added" title={t("scan.added", { n: totalAdded(entries) })} action={last ? <button className="navbtn" disabled={!!undoing} onClick={() => void undo(last)}>{t("scan.undo")}</button> : undefined}>
            {rows.length === 0 ? <p className="note">{t("scan.emptyPlus")}</p> : (
              <div className="group">
                {rows.map((e) => (
                  <div className="row scan-row" key={e.key} data-status={e.undone ? "undone" : e.status}>
                    <span className="row-main">
                      <span className="row-title">{e.productTitle}</span>
                      <span className="row-sub">{[e.variantTitle, e.undone ? t("scan.undone") : e.status === "failed" ? e.error : e.status === "sending" ? t("common.loading") : e.stocked !== null ? t("scan.nowStock", { n: e.stocked }) : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="row-end">
                      <Digits className="amount" text={e.undone ? "±0" : "+1"} />
                      {e.status === "failed" && !e.undone ? <button className="navbtn" onClick={() => void send(e)}>{t("scan.resend")}</button> : null}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {added.size > 1 ? <p className="note">{t("scan.variantsCounted", { n: added.size })}</p> : null}
          </Section>
        ) : (
          <Section id="tally" title={t("scan.counted", { n: tallyRows.length })}>
            {tallyRows.length === 0 ? <p className="note">{t("scan.emptyCount")}</p> : (
              <>
                <div className="group">
                  {tallyRows.map((r) => (
                    <div className="row scan-row" key={r.key}>
                      <span className="row-main">
                        <span className="row-title">{r.productTitle}</span>
                        <span className="row-sub">{[r.variantTitle, locations.length > 1 ? locations.find((l) => l.id === r.locationId)?.name : null, r.was === null ? t("scan.wasNone") : t("scan.was", { n: r.was })].filter(Boolean).join(" · ")}</span>
                        {tallyErrors[r.key] ? <FieldError id={`t-${r.variantId}-${r.locationId}`}>{tallyErrors[r.key]!}</FieldError> : null}
                      </span>
                      <Stepper value={r.counted} max={MAX_STOCK} label={r.productTitle} busy={applyBusy} onChange={(n) => setTally((p) => tallySet(p, r.key, n))} />
                      <button className="navbtn" aria-label={t("scan.remove", { name: r.productTitle })} disabled={applyBusy} onClick={() => setTally((p) => tallyRemove(p, r.key))}><Icon name="x" size="sm" /></button>
                    </div>
                  ))}
                </div>
                <button className="btn primary" disabled={applyBusy || !online} onClick={() => void applyTally()}>{t("scan.apply", { n: tallyRows.length })}</button>
                <p className="note">{t("scan.applyHint")}</p>
              </>
            )}
          </Section>
        )}
      </Scroll>

      {sheet?.kind === "unknown" ? (
        <AssignSheet shop={shop!} code={sheet.code} canAssign={allowed.variant_edit} onClose={() => setSheet(null)} onAssigned={(m) => { setSheet(null); apply(m) }} />
      ) : null}
      {sheet?.kind === "choose" ? (
        <PickSheet
          title={t("scan.chooseTitle")}
          text={t("scan.chooseText")}
          choices={sheet.matches.map((m) => ({ id: m.variant.id, title: title(m), sub: vtitle(m) || undefined }))}
          onClose={() => setSheet(null)}
          onPick={(id) => { const m = sheet.matches.find((x) => x.variant.id === id); setSheet(null); if (m) apply(m) }}
        />
      ) : null}
      {sheet?.kind === "place" ? (
        <PickSheet
          title={t("scan.placeTitle")}
          text={t("scan.placeText", { name: title(sheet.match) })}
          choices={(locations.length > 0 ? locations.map((l) => ({ id: l.id, title: l.name })) : (editableInventory(sheet.match.variant)?.levels ?? []).map((l) => ({ id: l.location_id, title: l.location_name })))}
          onClose={() => setSheet(null)}
          onPick={(id) => { const m = sheet.match; setSheet(null); apply(m, id) }}
        />
      ) : null}
    </div>
  )
}
