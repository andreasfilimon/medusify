import { AMOUNT_DECIMALS, BELOW_ZERO, CURRENCY_NOT_SUPPORTED, NOTHING_TO_UNDO, NO_LOCATION, catalogFailure } from "./api"
import type { Translate } from "./i18n"

/**
 * The sentence for a failed catalog call. `retrySafe`: the call carries an idempotency key, so tapping again after a lost
 * answer is the same request and cannot book twice; the sentence says so. A price or a status is set to a value, so
 * repeating it is harmless too, and says the same.
 */
export function catalogErrorText(t: Translate, err: unknown): { text: string; unknown: boolean } {
  const f = catalogFailure(err)
  switch (f.kind) {
    case "unknown": return { text: t("prod.failedUnknown"), unknown: true }
    case "auth": return { text: t("act.failedAuth"), unknown: false }
    case "forbidden": return { text: t("prod.failedForbidden"), unknown: false }
    case "old": return { text: t("prod.oldText"), unknown: false }
    case "rejected":
      switch (f.code) {
        case BELOW_ZERO: return { text: t("prod.failedBelowZero"), unknown: false }
        case NOTHING_TO_UNDO: return { text: t("prod.failedNothingToUndo"), unknown: false }
        case AMOUNT_DECIMALS: return { text: t("prod.failedDecimals"), unknown: false }
        case CURRENCY_NOT_SUPPORTED: return { text: t("prod.failedCurrency"), unknown: false }
        case NO_LOCATION: return { text: t("prod.failedLocation"), unknown: false }
        default: return { text: t("prod.failed", { reason: f.reason ?? t("act.failedGeneric") }), unknown: false }
      }
  }
}
