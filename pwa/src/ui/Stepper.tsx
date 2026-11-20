import { useApp } from "../app/context"
import { Icon } from "./Icon"
import { Digits } from "./kit"

/**
 * A number with a minus and a plus. The number can be a button of its own (`onOpen`) for typing a value; without it it is
 * plain text. Both buttons are 44 pt, and a bound switches its button off instead of letting the number go past it.
 */
export function Stepper({ value, min = 0, max, onChange, onOpen, label, busy }: { value: number; min?: number; max?: number; onChange(next: number): void; onOpen?(): void; label: string; busy?: boolean }) {
  const { t } = useApp()
  const at = (n: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, n))
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" className="step" aria-label={t("stepper.minus")} disabled={busy || value <= min} onClick={() => onChange(at(value - 1))}>
        <Icon name="minus" size="sm" />
      </button>
      {onOpen ? (
        <button type="button" className="step-value num" aria-label={t("stepper.value", { label, n: value })} onClick={onOpen}>
          <Digits text={String(value)} />
        </button>
      ) : (
        <output className="step-value num" aria-live="polite"><Digits text={String(value)} /></output>
      )}
      <button type="button" className="step" aria-label={t("stepper.plus")} disabled={busy || (max !== undefined && value >= max)} onClick={() => onChange(at(value + 1))}>
        <Icon name="plus" size="sm" />
      </button>
    </span>
  )
}
