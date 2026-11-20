import { useState } from "react"
import { useApp } from "../app/context"
import { MAX_STOCK, type LevelView } from "../lib/catalog"
import { catalogErrorText } from "../lib/catalog-text"
import type { Shop } from "../lib/types"
import { useStockWrite } from "../lib/use-stock-write"
import { CountSheet } from "./CountSheet"
import { FieldError } from "./kit"
import { Stepper } from "./Stepper"
import { useToast } from "./Toast"

/**
 * The stock of one variant at one place: a stepper that edits a draft, and a button that books the difference. The draft
 * is the typed or stepped number; what is booked is `adjust` by the difference, so a count that moved meanwhile (a scan on
 * another phone) is not overwritten but corrected by exactly what this phone changed.
 */
export function StockLevel({ shop, inventoryItemId, level, canEdit, label }: { shop: Shop; inventoryItemId: string; level: LevelView; canEdit: boolean; label: string }) {
  const { t, online } = useApp()
  const toast = useToast()
  const { write, forget } = useStockWrite(shop)
  // The draft belongs to the number it started from: a new number from the shop (after a save, a refresh) replaces it.
  const [draft, setDraft] = useState<{ from: number; value: number } | null>(null)
  const [counting, setCounting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = draft && draft.from === level.stocked ? draft.value : level.stocked
  const delta = value - level.stocked
  const edit = (n: number) => setDraft({ from: level.stocked, value: n })

  async function save() {
    if (busy || delta === 0) return
    setBusy(true)
    setError(null)
    try {
      await write(inventoryItemId, level.location_id, delta, level.stocked)
      setDraft(null)
      toast.show(t("prod.stockDone"))
    } catch (err) {
      setError(catalogErrorText(t, err).text)
    } finally {
      setBusy(false)
    }
  }

  const sub = [t("prod.reserved", { n: level.reserved }), level.incoming > 0 ? t("prod.incoming", { n: level.incoming }) : null].filter(Boolean).join(" · ")
  return (
    <div className="level">
      <div className="level-main">
        <span className="row-title">{level.location_name}</span>
        <span className="row-sub">{sub}</span>
      </div>
      {canEdit ? (
        <Stepper value={value} max={MAX_STOCK} label={label} busy={busy} onChange={edit} onOpen={() => setCounting(true)} />
      ) : (
        <span className="num level-fixed">{level.stocked}</span>
      )}
      {delta !== 0 ? (
        <div className="level-save">
          <button className="btn primary" disabled={busy || !online} onClick={() => void save()}>
            {t("prod.stockSave", { delta: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}` })}
          </button>
          <button className="btn quiet" disabled={busy} onClick={() => { setDraft(null); setError(null); forget(inventoryItemId, level.location_id) }}>{t("prod.discard")}</button>
        </div>
      ) : null}
      {error ? <FieldError id={`${level.location_id}-err`}>{error}</FieldError> : null}
      {counting ? <CountSheet title={t("prod.countTitle")} label={level.location_name} initial={value} onDone={(n) => { edit(n); setCounting(false) }} onClose={() => setCounting(false)} /> : null}
    </div>
  )
}
