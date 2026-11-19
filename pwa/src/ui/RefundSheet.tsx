import { useEffect, useId, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import { amountFieldText, checkAmount, fractionDigits, toMinor, type AmountCheck } from "../lib/amount"
import * as api from "../lib/api"
import { formatMoney } from "../lib/format"
import type { Order, Shop } from "../lib/types"
import { useAction } from "../lib/use-action"
import { useAttempt } from "../lib/use-attempt"
import { AttemptLock } from "./AttemptLock"
import { ConfirmBody } from "./ConfirmSheet"
import { FieldError } from "./kit"
import { Sheet, SheetAction } from "./Sheet"

/** Refund in two steps: the amount, then the confirmation with amount, currency and shop; only its red button sends. */
export function RefundSheet({ shop, order, paymentId, max, onClose }: { shop: Shop; order: Order; paymentId: string; max: number; onClose(): void }) {
  const { t, lang, online } = useApp()
  const currency = order.currency_code
  const { run, busy, error } = useAction()
  const [raw, setRaw] = useState("")
  const [touched, setTouched] = useState(false)
  const [confirming, setConfirming] = useState<number | null>(null)
  // One key per refund of this payment, kept in lib/attempt.ts: going back, closing the sheet or opening it again after a
  // lost answer is still the same refund for the shop, not a second one.
  const attempt = useAttempt(`${shop.id}|refund|${order.id}|${paymentId}`, `${shop.id}|${order.id}`, String(toMinor(max, currency)))
  const [landed, setLanded] = useState(false)
  const errId = useId()
  const fieldErr = useId()
  const formId = useId()
  const amountId = useId()
  const check: AmountCheck = checkAmount(raw, currency, max)

  const problem = (): string | null => {
    if (check.ok) return null
    switch (check.reason) {
      case "empty": return t("act.amount.empty")
      case "invalid": return t("act.amount.invalid")
      case "zero": return t("act.amount.zero")
      case "decimals": return t("act.amount.decimals", { n: fractionDigits(currency) })
      case "above": return t("act.amount.above", { max: formatMoney(max, currency, lang) })
    }
  }

  function review(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (check.ok) setConfirming(check.value)
  }

  // The shop did the refund whose answer was lost: what is left to refund is less now. Start again from that.
  useEffect(() => {
    if (attempt.gate !== "landed") return
    attempt.done()
    setConfirming(null)
    setRaw("")
    setTouched(false)
    setLanded(true)
  }, [attempt])

  const locked = attempt.gate === "locked"
  const send = () => {
    if (confirming === null || locked) return
    const key = attempt.begin(String(toMinor(confirming, currency)))
    void run(() => api.refundPayment(shop, paymentId, confirming, key), t("act.refundDone"), undefined, attempt.onOutcome).then((ok) => {
      if (ok) {
        attempt.done()
        onClose()
      }
    })
  }

  if (confirming !== null) {
    const amount = formatMoney(confirming, currency, lang)
    return (
      <Sheet title={t("act.refundConfirmTitle")} onClose={onClose} locked={busy}>
        <ConfirmBody
          text={t("act.refundBody")}
          facts={[
            { label: t("act.fact.amount"), value: amount },
            { label: t("act.fact.currency"), value: currency.toUpperCase() },
            { label: t("act.fact.shop"), value: shop.name },
            { label: t("act.fact.order"), value: `#${order.display_id}` },
          ]}
          label={t("act.refundConfirm", { amount })}
          danger
          busy={busy || locked}
          error={error}
          offline={!online}
          onConfirm={send}
          errId={errId}
        />
        {locked && !busy ? <AttemptLock onReload={() => void attempt.reload()} busy={busy} /> : null}
        <button className="btn quiet" disabled={busy} onClick={() => setConfirming(null)}>{t("act.refundBack")}</button>
      </Sheet>
    )
  }

  const shown = touched ? problem() : null
  return (
    <Sheet title={t("act.refundTitle")} onClose={onClose}>
      {landed ? <p className="sheet-text" role="status">{t("act.landed")}</p> : null}
      <form className="form" id={formId} onSubmit={review} noValidate>
        <div className="field">
          <label htmlFor={amountId}>{t("act.refundAmount", { currency: currency.toUpperCase() })}</label>
          <div className="field-box">
          <input
            id={amountId}
            type="text"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="go"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={() => raw !== "" && setTouched(true)}
            aria-invalid={shown !== null}
            aria-describedby={shown ? fieldErr : undefined}
          />
          <button type="button" className="addon" onClick={() => { setRaw(amountFieldText(max, currency, lang)); setTouched(true) }}>
            {t("act.refundAll", { amount: formatMoney(max, currency, lang) })}
          </button>
          </div>
        </div>
        {shown ? <FieldError id={fieldErr}>{shown}</FieldError> : null}
      </form>
      <SheetAction label={t("act.refundReview")} form={formId} disabled={!check.ok} />
    </Sheet>
  )
}
