import { useId, useState, type SubmitEvent } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useApp } from "../app/context"
import { amountFieldText, checkAmount, fractionDigits } from "../lib/amount"
import * as api from "../lib/api"
import { catalogErrorText } from "../lib/catalog-text"
import type { Shop } from "../lib/types"
import { FieldError } from "./kit"
import { Sheet, SheetAction } from "./Sheet"
import { useToast } from "./Toast"

/** The highest price the field takes: far above any real price, below what the shop's number type holds. */
export const MAX_PRICE = 10_000_000

/**
 * Changes the plain price of one currency of a variant. The shop keeps the variant's other prices (the plugin sends the
 * whole list back); a price is a value, so sending it again after a lost answer is the same write.
 */
export function PriceSheet({ shop, variantId, currency, current, label, onClose }: { shop: Shop; variantId: string; currency: string; current: number | null; label: string; onClose(): void }) {
  const { t, lang } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const [raw, setRaw] = useState(current === null ? "" : amountFieldText(current, currency, lang))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = useId()
  const inputId = useId()
  const errId = useId()
  const check = checkAmount(raw, currency, MAX_PRICE)
  const problem = check.ok ? null : t(`prod.price.${check.reason}` as "prod.price.empty", { n: fractionDigits(currency) })

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (!check.ok || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.setBasePrice(shop, variantId, currency, check.value)
      await Promise.all([qc.invalidateQueries({ queryKey: ["product"] }), qc.invalidateQueries({ queryKey: ["products"] })])
      toast.show(t("prod.priceDone"))
      onClose()
    } catch (err) {
      setError(catalogErrorText(t, err).text)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t("prod.priceTitle")} onClose={onClose} locked={busy}>
      <form className="form" id={formId} onSubmit={submit} noValidate>
        <p className="sheet-text">{label}</p>
        <div className="field">
          <label htmlFor={inputId}>{t("prod.priceField", { currency: currency.toUpperCase() })}</label>
          <input id={inputId} type="text" name="price" inputMode="decimal" autoComplete="off" enterKeyHint="done" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={() => raw !== "" && setTouched(true)} aria-invalid={touched && !check.ok} aria-describedby={(touched && problem) || error ? errId : undefined} />
        </div>
        {touched && problem ? <FieldError id={errId}>{problem}</FieldError> : null}
        {error ? <FieldError id={errId}>{error}</FieldError> : null}
      </form>
      <SheetAction label={t("prod.save")} form={formId} disabled={!check.ok || busy} />
    </Sheet>
  )
}
