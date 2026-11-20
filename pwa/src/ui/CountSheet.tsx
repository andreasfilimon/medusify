import { useId, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import { MAX_STOCK, parseCount } from "../lib/catalog"
import { FieldError } from "./kit"
import { Sheet, SheetAction } from "./Sheet"

/** Types one stock number: a whole number from 0 up to the limit. Nothing is sent from here; the caller decides what the number does. */
export function CountSheet({ title, label, initial, onDone, onClose }: { title: string; label: string; initial: number; onDone(n: number): void; onClose(): void }) {
  const { t } = useApp()
  const [raw, setRaw] = useState(String(initial))
  const [touched, setTouched] = useState(false)
  const formId = useId()
  const inputId = useId()
  const errId = useId()
  const n = parseCount(raw)
  const submit = (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault()
    setTouched(true)
    if (n !== null) onDone(n)
  }
  return (
    <Sheet title={title} onClose={onClose}>
      <form className="form" id={formId} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={inputId}>{label}</label>
          <input id={inputId} type="text" name="count" inputMode="numeric" autoComplete="off" enterKeyHint="done" autoFocus value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && n === null} aria-describedby={touched && n === null ? errId : undefined} />
        </div>
        {touched && n === null ? <FieldError id={errId}>{t("prod.countInvalid", { max: MAX_STOCK.toLocaleString("de-AT") })}</FieldError> : null}
      </form>
      <SheetAction label={t("prod.apply")} form={formId} disabled={n === null} />
    </Sheet>
  )
}
