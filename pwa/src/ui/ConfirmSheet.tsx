import { useApp } from "../app/context"
import { FieldError } from "./kit"

export type Fact = { label: string; value: string }

/**
 * The last step of an action that cannot be taken back: what happens, the facts, and one button. `danger` makes it the
 * red button, which only refunds and cancellations use. The button is dead while the request runs.
 */
export function ConfirmBody({
  text, facts, label, danger, busy, error, offline, onConfirm, errId,
}: {
  text: string
  facts?: Fact[]
  label: string
  danger?: boolean
  busy: boolean
  error: string | null
  offline: boolean
  onConfirm(): void
  errId: string
}) {
  const { t } = useApp()
  return (
    <div className="confirm">
      <p className="sheet-text">{text}</p>
      {facts?.length ? (
        <dl className="group">
          {facts.map((f) => (
            <div className="kv" key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      ) : null}
      {error ? <FieldError id={errId}>{error}</FieldError> : null}
      {offline ? <p className="sheet-text">{t("act.offline")}</p> : null}
      <button className={`btn ${danger ? "danger" : "primary"} form-submit`} disabled={busy || offline} aria-describedby={error ? errId : undefined} onClick={onConfirm}>
        {label}
      </button>
    </div>
  )
}
