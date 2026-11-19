import { useEffect, useId, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import type { ReturnableItem } from "../lib/actions"
import { suggestedRefund } from "../lib/actions"
import { amountFieldText, checkAmount, fractionDigits, toMinor } from "../lib/amount"
import * as api from "../lib/api"
import { formatMoney } from "../lib/format"
import type { Order, Shop } from "../lib/types"
import { useAction } from "../lib/use-action"
import { useAttempt } from "../lib/use-attempt"
import { AttemptLock } from "./AttemptLock"
import { ConfirmBody } from "./ConfirmSheet"
import { Icon } from "./Icon"
import { FieldError } from "./kit"
import { Sheet, SheetAction } from "./Sheet"

/**
 * Accept a return: pick the items and quantities, optionally refund right away, confirm. The plugin route runs Medusa's
 * return workflows in one go (request, receive, refund) and checks the refund against what is still refundable.
 */
export function ReturnSheet({
  shop, order, items, refund, onClose,
}: { shop: Shop; order: Order; items: ReturnableItem[]; refund: { max: number } | null; onClose(): void }) {
  const { t, lang, online } = useApp()
  const currency = order.currency_code
  const { run, busy, error } = useAction()
  const [chosen, setChosen] = useState<Record<string, number>>({})
  const [withRefund, setWithRefund] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  const [step, setStep] = useState<"form" | "confirm">("form")
  const [touched, setTouched] = useState(false)
  const [landed, setLanded] = useState(false)
  const errId = useId()
  const formId = useId()
  const fieldErr = useId()

  const count = Object.values(chosen).reduce((a, b) => a + b, 0)
  const max = refund?.max ?? 0
  // One key per return of this order, kept in lib/attempt.ts: going back, closing the sheet or opening it again after a
  // lost answer is still the same return for the shop. The state is what a successful return would change.
  const attempt = useAttempt(
    `${shop.id}|return|${order.id}`,
    `${shop.id}|${order.id}`,
    `${items.map((i) => `${i.id}:${i.max}`).join(",")}|${toMinor(max, currency)}`,
  )
  const suggestion = suggestedRefund(items, chosen, currency, max)
  const raw = typed ?? (suggestion > 0 ? amountFieldText(suggestion, currency, lang) : "")
  const check = checkAmount(raw, currency, max)
  const amountOk = !withRefund || check.ok
  const ready = count > 0 && amountOk

  const step1 = (id: string, by: number, limit: number) => setChosen((c) => ({ ...c, [id]: Math.min(limit, Math.max(0, (c[id] ?? 0) + by)) }))

  const problem = (): string | null => {
    if (!withRefund || check.ok) return null
    switch (check.reason) {
      case "empty": return t("act.amount.empty")
      case "invalid": return t("act.amount.invalid")
      case "zero": return t("act.amount.zero")
      case "decimals": return t("act.amount.decimals", { n: fractionDigits(currency) })
      case "above": return t("act.amount.above", { max: formatMoney(max, currency, lang) })
    }
  }

  /** What this return is, for the key: the same items and refund give the same string, whatever the order of the items. */
  const content = () =>
    `${items.filter((i) => (chosen[i.id] ?? 0) > 0).map((i) => `${i.id}x${chosen[i.id]}`).sort().join(",")}|${withRefund && check.ok ? toMinor(check.value, currency) : 0}`

  const body = (key: string) => ({
    order_id: order.id,
    idempotency_key: key,
    items: items.filter((i) => (chosen[i.id] ?? 0) > 0).map((i) => ({ id: i.id, quantity: chosen[i.id]! })),
    ...(withRefund && check.ok ? { refund_amount: check.value } : {}),
  })

  function review(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (ready) setStep("confirm")
  }

  // The shop did the return whose answer was lost: those units can no longer come back. Start again from the order.
  useEffect(() => {
    if (attempt.gate !== "landed") return
    attempt.done()
    setChosen({})
    setWithRefund(false)
    setTyped(null)
    setTouched(false)
    setStep("form")
    setLanded(true)
  }, [attempt])

  const locked = attempt.gate === "locked"
  const send = () => {
    if (locked) return
    const done = withRefund ? t("act.returnDoneRefund") : t("act.returnDone")
    const key = attempt.begin(content())
    void run(() => api.acceptReturn(shop, body(key)), done, undefined, attempt.onOutcome).then((ok) => {
      if (ok) {
        attempt.done()
        onClose()
      }
    })
  }

  if (step === "confirm") {
    const amount = withRefund && check.ok ? formatMoney(check.value, currency, lang) : null
    return (
      <Sheet title={t("act.returnTitle")} onClose={onClose} locked={busy}>
        <ConfirmBody
          text={amount ? t("act.returnBodyRefund") : t("act.returnBody")}
          facts={[
            { label: t("act.returnItems"), value: String(count) },
            ...(amount
              ? [
                  { label: t("act.fact.amount"), value: amount },
                  { label: t("act.fact.currency"), value: currency.toUpperCase() },
                ]
              : []),
            { label: t("act.fact.shop"), value: shop.name },
            { label: t("act.fact.order"), value: `#${order.display_id}` },
          ]}
          label={amount ? t("act.returnConfirmRefund", { amount }) : t("act.returnConfirm")}
          danger={!!amount}
          busy={busy || locked}
          error={error}
          offline={!online}
          onConfirm={send}
          errId={errId}
        />
        {locked && !busy ? <AttemptLock onReload={() => void attempt.reload()} busy={busy} /> : null}
        <button className="btn quiet" disabled={busy} onClick={() => setStep("form")}>{t("act.refundBack")}</button>
      </Sheet>
    )
  }

  const shown = touched ? problem() : null
  return (
    <Sheet title={t("act.returnTitle")} onClose={onClose}>
      {landed ? <p className="sheet-text" role="status">{t("act.landed")}</p> : null}
      <form className="form" id={formId} onSubmit={review} noValidate>
        <p className="sheet-text">{t("act.returnItems")}</p>
        <div className="group">
          {items.map((i) => {
            const n = chosen[i.id] ?? 0
            return (
              <div className="row" key={i.id}>
                <span className="row-main">
                  <span className="row-title reg wrap">{i.title}</span>
                  <span className="row-sub">{[i.variant, `${n} / ${i.max}`].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="stepper" role="group" aria-label={t("act.returnQty", { title: i.title })}>
                  <button type="button" aria-label={t("act.returnLess")} disabled={n <= 0} onClick={() => step1(i.id, -1, i.max)}>−</button>
                  <output aria-live="polite">{n}</output>
                  <button type="button" aria-label={t("act.returnMore")} disabled={n >= i.max} onClick={() => step1(i.id, 1, i.max)}>+</button>
                </span>
              </div>
            )
          })}
        </div>
        {count === 0 && touched ? <FieldError id={errId}>{t("act.returnNone")}</FieldError> : null}
        {refund ? (
          <>
            <label className="row single switch-row">
              <span className="row-main"><span className="row-title reg">{t("act.returnRefund")}</span></span>
              <input type="checkbox" role="switch" checked={withRefund} onChange={(e) => setWithRefund(e.target.checked)} />
            </label>
            {withRefund ? (
              <>
                <label className="field">
                  <span>{t("act.refundAmount", { currency: currency.toUpperCase() })}</span>
                  <input
                    type="text"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    value={raw}
                    onChange={(e) => setTyped(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={shown !== null}
                    aria-describedby={shown ? fieldErr : undefined}
                  />
                  <small className="help"><Icon name="info" size="xs" />{t("act.returnRefundHelp", { max: formatMoney(max, currency, lang) })}</small>
                </label>
                {shown ? <FieldError id={fieldErr}>{shown}</FieldError> : null}
              </>
            ) : null}
          </>
        ) : null}
      </form>
      <SheetAction label={t("act.returnReview")} form={formId} disabled={!ready} />
    </Sheet>
  )
}
