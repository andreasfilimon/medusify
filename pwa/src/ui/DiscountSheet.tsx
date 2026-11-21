import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useId, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import { checkAmount, fractionDigits } from "../lib/amount"
import * as api from "../lib/api"
import { catalogErrorText } from "../lib/catalog-text"
import { checkCode, checkLimit, checkPercent, CODE_MAX } from "../lib/discounts"
import type { Shop } from "../lib/types"
import { FieldError, Segmented } from "./kit"
import { Sheet, SheetAction } from "./Sheet"
import { useToast } from "./Toast"

/** The highest fixed amount a code may take off: far above any real discount. */
export const MAX_DISCOUNT = 1_000_000

/** A new code for the whole order, active at once: per cent or a fixed amount in one currency, optionally limited. */
export function DiscountSheet({ shop, onClose }: { shop: Shop; onClose(): void }) {
  const { t } = useApp()
  const qc = useQueryClient()
  const toast = useToast()
  const currencies = useQuery({ queryKey: ["currencies", shop.id], queryFn: () => api.storeCurrencies(shop), staleTime: 5 * 60_000 })
  const [code, setCode] = useState("")
  const [type, setType] = useState<"percentage" | "fixed">("percentage")
  const [raw, setRaw] = useState("")
  const [chosen, setChosen] = useState<string | null>(null)
  const [limit, setLimit] = useState("")
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formId = useId()
  const ids = { code: useId(), value: useId(), currency: useId(), limit: useId(), err: useId() }

  const currency = chosen ?? currencies.data?.[0] ?? null
  const codeCheck = checkCode(code)
  const percent = checkPercent(raw)
  const amount = currency ? checkAmount(raw, currency, MAX_DISCOUNT) : null
  const limitCheck = checkLimit(limit)
  const valueOk = type === "percentage" ? percent.ok : !!amount?.ok
  const ok = codeCheck.ok && valueOk && limitCheck.ok
  const problems = {
    code: codeCheck.ok ? null : t(`disc.code.${codeCheck.reason}` as "disc.code.short", { n: CODE_MAX }),
    value: type === "percentage"
      ? percent.ok ? null : t(`disc.percent.${percent.reason}` as "disc.percent.empty")
      : !currency ? t("disc.noCurrency") : amount && !amount.ok ? t(`prod.price.${amount.reason}` as "prod.price.empty", { n: fractionDigits(currency) }) : null,
    limit: limitCheck.ok ? null : t("disc.limitInvalid"),
  }

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (!ok || busy || !codeCheck.ok || !limitCheck.ok) return
    const value = type === "percentage" ? (percent.ok ? percent.value : 0) : amount?.ok ? amount.value : 0
    setBusy(true)
    setError(null)
    try {
      const made = await api.createDiscount(shop, { code: codeCheck.code, type, value, currency_code: type === "fixed" ? currency : null, limit: limitCheck.value })
      await qc.invalidateQueries({ queryKey: ["discounts"] })
      toast.show(t("disc.created", { code: made.code }))
      onClose()
    } catch (err) {
      const f = api.catalogFailure(err)
      setError(f.kind === "rejected" && f.code === api.DISCOUNT_CODE_TAKEN ? t("disc.taken") : catalogErrorText(t, err).text)
    } finally {
      setBusy(false)
    }
  }

  const show = (p: string | null) => touched && p
  return (
    <Sheet title={t("disc.new")} onClose={onClose} locked={busy}>
      <form className="form" id={formId} onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={ids.code}>{t("disc.codeField")}</label>
          <input id={ids.code} type="text" name="code" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={CODE_MAX + 8} autoFocus value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-invalid={!!show(problems.code)} aria-describedby={show(problems.code) ? `${ids.code}-e` : undefined} />
        </div>
        {show(problems.code) ? <FieldError id={`${ids.code}-e`}>{problems.code!}</FieldError> : null}
        <Segmented
          label={t("disc.kind")}
          value={type}
          onChange={(v) => setType(v)}
          options={[{ value: "percentage", label: t("disc.kindPercent") }, { value: "fixed", label: t("disc.kindFixed") }]}
        />
        <div className="field">
          <label htmlFor={ids.value}>{type === "percentage" ? t("disc.percentField") : t("disc.amountField", { currency: (currency ?? "").toUpperCase() })}</label>
          <input id={ids.value} type="text" name="value" inputMode="decimal" autoComplete="off" value={raw} onChange={(e) => setRaw(e.target.value)} aria-invalid={!!show(problems.value)} aria-describedby={show(problems.value) ? `${ids.value}-e` : undefined} />
        </div>
        {show(problems.value) ? <FieldError id={`${ids.value}-e`}>{problems.value!}</FieldError> : null}
        {type === "fixed" && (currencies.data?.length ?? 0) > 1 ? (
          <div className="field">
            <label htmlFor={ids.currency}>{t("disc.currency")}</label>
            <select id={ids.currency} value={currency ?? ""} onChange={(e) => setChosen(e.target.value)}>
              {currencies.data!.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={ids.limit}>{t("disc.limitField")}</label>
          <input id={ids.limit} type="text" name="limit" inputMode="numeric" autoComplete="off" placeholder={t("disc.limitNone")} value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={!!show(problems.limit)} aria-describedby={show(problems.limit) ? `${ids.limit}-e` : undefined} />
        </div>
        {show(problems.limit) ? <FieldError id={`${ids.limit}-e`}>{problems.limit!}</FieldError> : null}
        <p className="note">{t("disc.note")}</p>
        {error ? <FieldError id={ids.err}>{error}</FieldError> : null}
      </form>
      <SheetAction label={t("disc.create")} form={formId} disabled={busy} />
    </Sheet>
  )
}
