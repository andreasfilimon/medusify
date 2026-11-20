import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useRef, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { MAX_STOCK, parseCount } from "../lib/catalog"
import { catalogErrorText } from "../lib/catalog-text"
import type { Shop } from "../lib/types"
import { FieldError } from "./kit"
import { Sheet, SheetAction } from "./Sheet"
import { useToast } from "./Toast"

/** Starts the stock of a tracked variant at a place where it has none yet (a new level; needs the right "stock_new_level"). */
export function AddLevelSheet({ shop, inventoryItemId, have, onClose }: { shop: Shop; inventoryItemId: string; have: string[]; onClose(): void }) {
  const { t } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const places = useQuery({ queryKey: ["locations", shop.id], queryFn: () => api.stockLocations(shop), staleTime: 5 * 60_000 })
  const free = (places.data ?? []).filter((l) => !have.includes(l.id))
  const [chosen, setChosen] = useState<string | null>(null)
  const [raw, setRaw] = useState("0")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One key for this sheet: a second tap after a lost answer is the same request, not a second booking.
  const key = useRef(crypto.randomUUID())
  const formId = useId()
  const selectId = useId()
  const countId = useId()
  const errId = useId()
  const location = chosen && free.some((l) => l.id === chosen) ? chosen : free[0]?.id
  const n = parseCount(raw)

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (busy || !location || n === null) return
    setBusy(true)
    setError(null)
    try {
      await api.changeStock(shop, { mode: "set", inventory_item_id: inventoryItemId, location_id: location, quantity: n, idempotency_key: key.current })
      await Promise.all([qc.invalidateQueries({ queryKey: ["product"] }), qc.invalidateQueries({ queryKey: ["products"] })])
      toast.show(t("prod.stockDone"))
      onClose()
    } catch (err) {
      const f = catalogErrorText(t, err)
      if (!f.unknown) key.current = crypto.randomUUID()
      setError(f.text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t("prod.addPlace")} onClose={onClose} locked={busy}>
      {places.isPending ? <p className="sheet-text" role="status">{t("common.loading")}</p> : null}
      {!places.isPending && free.length === 0 ? <p className="sheet-text">{t("prod.noFreePlace")}</p> : null}
      {free.length > 0 ? (
        <form className="form" id={formId} onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor={selectId}>{t("prod.place")}</label>
            <select id={selectId} value={location} onChange={(e) => setChosen(e.target.value)}>
              {free.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={countId}>{t("prod.startCount")}</label>
            <input id={countId} type="text" name="count" inputMode="numeric" autoComplete="off" enterKeyHint="done" value={raw} onChange={(e) => setRaw(e.target.value)} aria-invalid={n === null} />
          </div>
          {n === null ? <FieldError id={errId}>{t("prod.countInvalid", { max: MAX_STOCK.toLocaleString("de-AT") })}</FieldError> : null}
          {error ? <FieldError id={errId}>{error}</FieldError> : null}
        </form>
      ) : null}
      <SheetAction label={t("prod.save")} form={formId} disabled={busy || !location || n === null} />
    </Sheet>
  )
}
