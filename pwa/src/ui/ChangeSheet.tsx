import { useEffect, useId, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { formatMoney } from "../lib/format"
import { addLine, setQuantity, type ManualLine } from "../lib/manual-order"
import {
  CLAIM_REASONS,
  changeBody,
  changeContent,
  changeErrorCode,
  changeLines,
  changeState,
  moneyWay,
  type ChangeBody,
  type ChangeKind,
  type ChangeMoney,
  type ClaimReason,
} from "../lib/order-change"
import type { Order, Shop } from "../lib/types"
import { actionErrorText, useAction } from "../lib/use-action"
import { useAttempt } from "../lib/use-attempt"
import { AttemptLock } from "./AttemptLock"
import { ConfirmBody } from "./ConfirmSheet"
import { Icon } from "./Icon"
import { FieldError, Segmented } from "./kit"
import { PickVariantSheet } from "./PickVariantSheet"
import { Sheet, SheetAction } from "./Sheet"
import { Stepper } from "./Stepper"

/**
 * Change an order after it was placed: new quantities or new lines (edit), lines back and others out (exchange), broken or
 * wrong lines refunded or sent again (claim). The shop prices the change first (preview, nothing stays changed); the
 * merchant confirms that amount, and the shop makes the change only while the amount is still the same.
 * Money is not moved here: what is left to pay or to give back shows on the order, for "mark as paid" or "refund".
 */
export function ChangeSheet({ shop, order, kind, onClose }: { shop: Shop; order: Order; kind: ChangeKind; onClose(): void }) {
  const { t, lang, online } = useApp()
  const currency = order.currency_code
  const money = (n: number) => formatMoney(Math.abs(n), currency, lang)
  const { run, busy, error, clearError } = useAction()
  const lines = changeLines(order, kind)
  const [wanted, setWanted] = useState<Record<string, number>>({})
  const [added, setAdded] = useState<ManualLine[]>([])
  const [reason, setReason] = useState<ClaimReason>("production_failure")
  const [claimType, setClaimType] = useState<"refund" | "replace">("refund")
  const [picking, setPicking] = useState(false)
  const [touched, setTouched] = useState(false)
  const [step, setStep] = useState<"form" | "confirm">("form")
  const [price, setPrice] = useState<ChangeMoney | null>(null)
  const [pricing, setPricing] = useState(false)
  const [priceError, setPriceError] = useState<string | null>(null)
  const [moved, setMoved] = useState(false)
  const [landed, setLanded] = useState(false)
  const errId = useId()
  const formId = useId()

  const attempt = useAttempt(`${shop.id}|change|${order.id}`, `${shop.id}|${order.id}`, changeState(order))
  const current: ChangeBody | null = changeBody(kind, lines, wanted, added, { reason, type: claimType }, order)
  const problem = current ? null : kind === "edit" ? t("oc.nothing") : kind === "exchange" ? (Object.values(wanted).some((n) => n > 0) ? t("oc.outMissing") : t("oc.backMissing")) : t("oc.claimMissing")

  /** The shop's words for a refusal of this route; Medusa's own messages pass through. */
  const failure = (err: unknown) => {
    const code = changeErrorCode(err)
    if (code) return code === "not_allowed" ? t("oc.err.not_allowed") : t(`oc.err.${code}`)
    return actionErrorText(t, err).text
  }

  async function check(change: ChangeBody) {
    setPricing(true)
    setPriceError(null)
    try {
      const p = await api.previewChange(shop, order.id, change)
      setPrice(p)
      setStep("confirm")
    } catch (err) {
      setPriceError(failure(err))
    } finally {
      setPricing(false)
    }
  }

  function review(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (current && !pricing) void check(current)
  }

  // The change whose answer was lost was made: start again from the order as it is now.
  useEffect(() => {
    if (attempt.gate !== "landed") return
    attempt.done()
    setWanted({})
    setAdded([])
    setTouched(false)
    setPrice(null)
    setStep("form")
    setLanded(true)
  }, [attempt])

  const locked = attempt.gate === "locked"
  const send = () => {
    if (locked || !current || !price) return
    const done = kind === "edit" ? t("oc.done") : kind === "exchange" ? t("oc.exchangeDone") : t("oc.claimDone")
    const key = attempt.begin(`${changeContent(current)}|${Math.round(price.difference * 100)}`)
    let changed = false
    void run(
      () =>
        api.applyChange(shop, order.id, current, price.difference, key).catch((err) => {
          changed = changeErrorCode(err) === "difference_changed"
          throw err
        }),
      done,
      undefined,
      attempt.onOutcome,
    ).then((ok) => {
      if (ok) {
        attempt.done()
        onClose()
      } else if (changed) {
        // the price moved since the preview: show the new numbers to confirm again
        setMoved(true)
        clearError()
        void check(current)
      }
    })
  }

  const title = kind === "edit" ? t("oc.edit") : kind === "exchange" ? t("oc.exchange") : t("oc.claim")

  if (step === "confirm" && price && current) {
    const way = moneyWay(price.difference)
    const goods = price.goods_value > 0.004 ? money(price.goods_value) : null
    const notes = [
      kind === "exchange" && goods ? t("oc.exchangeGoods", { amount: goods }) : null,
      kind === "claim" && claimType === "refund" && goods ? t("oc.claimGoods", { amount: goods }) : null,
      way === "pay" ? t("oc.payNote") : way === "back" ? t("oc.backNote") : null,
    ].filter((n): n is string => !!n)
    const sentence = way === "pay" ? t("oc.pay", { amount: money(price.difference) }) : way === "back" ? t("oc.giveBack", { amount: money(price.difference) }) : t("oc.even")
    return (
      <Sheet title={title} onClose={onClose} locked={busy}>
        {moved ? <p className="note bad" role="status">{t("oc.err.difference_changed")}</p> : null}
        <ConfirmBody
          text={sentence}
          facts={[
            { label: t("oc.before"), value: formatMoney(price.total_before, currency, lang) },
            { label: t("oc.after"), value: formatMoney(price.total_after, currency, lang) },
            { label: t("act.fact.shop"), value: shop.name },
            { label: t("act.fact.order"), value: `#${order.display_id}` },
          ]}
          label={t("oc.confirm")}
          busy={busy || locked || pricing}
          error={error}
          offline={!online}
          onConfirm={send}
          errId={errId}
        />
        {notes.map((n) => <p className="note" key={n}><Icon name="info" size="xs" /> {n}</p>)}
        {locked && !busy ? <AttemptLock onReload={() => void attempt.reload()} busy={busy} /> : null}
        <button className="btn quiet" disabled={busy} onClick={() => { clearError(); setMoved(false); setStep("form") }}>{t("act.refundBack")}</button>
      </Sheet>
    )
  }

  const stepLabel = (title: string) => kind === "edit" ? t("oc.qty", { title }) : t("oc.backQty", { title })
  const shown = touched && problem
  return (
    <Sheet title={title} onClose={onClose}>
      {landed ? <p className="sheet-text" role="status">{t("act.landed")}</p> : null}
      <form className="form" id={formId} onSubmit={review} noValidate>
        <p className="sheet-text">{kind === "edit" ? t("oc.lines") : kind === "exchange" ? t("oc.back") : t("oc.claimLines")}</p>
        <div className="group">
          {lines.map((l) => {
            const n = wanted[l.id] ?? l.start
            const sub = [l.variant, kind === "edit" ? (l.min > 0 ? t("oc.sent", { n: l.min }) : null) : `${n} / ${l.max}`].filter(Boolean).join(" · ")
            return (
              <div className="row" key={l.id}>
                <span className="row-main">
                  <span className="row-title reg wrap">{l.title}</span>
                  {sub ? <span className="row-sub">{sub}</span> : null}
                </span>
                <Stepper value={n} min={l.min} max={l.max} label={stepLabel(l.title)} onChange={(v) => setWanted((w) => ({ ...w, [l.id]: v }))} />
              </div>
            )
          })}
        </div>

        {kind === "claim" ? (
          <>
            <label className="field">
              <span>{t("oc.reason")}</span>
              <select name="reason" value={reason} onChange={(e) => setReason(e.target.value as ClaimReason)}>
                {CLAIM_REASONS.map((r) => <option key={r} value={r}>{t(`oc.reason.${r}`)}</option>)}
              </select>
            </label>
            <Segmented<"refund" | "replace">
              label={t("oc.type")}
              value={claimType}
              options={[{ value: "refund", label: t("oc.type.refund") }, { value: "replace", label: t("oc.type.replace") }]}
              onChange={setClaimType}
            />
          </>
        ) : null}

        {kind !== "claim" ? (
          <>
            <p className="sheet-text">{kind === "edit" ? t("oc.newLines") : t("oc.newOut")}</p>
            {added.length ? (
              <div className="group">
                {added.map((l) => (
                  <div className="row" key={l.variant_id}>
                    <span className="row-main">
                      <span className="row-title reg wrap">{l.title}</span>
                      <span className="row-sub">{[l.variant, l.unit === null ? t("mo.noPrice") : formatMoney(l.unit, currency, lang)].filter(Boolean).join(" · ")}</span>
                    </span>
                    <Stepper value={l.quantity} min={0} max={l.max ?? undefined} label={t("mo.count", { title: l.title })} onChange={(v) => setAdded((cur) => setQuantity(cur, l.variant_id, v))} />
                  </div>
                ))}
              </div>
            ) : null}
            <button type="button" className="btn quiet" onClick={() => setPicking(true)}>
              <Icon name="plus" size="sm" /> {t("oc.add")}
            </button>
          </>
        ) : null}

        {shown ? <FieldError id={errId}>{problem}</FieldError> : null}
        {priceError ? <p className="note bad" role="alert">{priceError}</p> : null}
        {!online ? <p className="note">{t("act.offline")}</p> : null}
      </form>
      <SheetAction label={pricing ? t("oc.checking") : t("oc.check")} form={formId} disabled={pricing || !online} />
      {picking ? <PickVariantSheet shop={shop} currency={currency} onPick={(l) => setAdded((cur) => addLine(cur, l))} onClose={() => setPicking(false)} /> : null}
    </Sheet>
  )
}
