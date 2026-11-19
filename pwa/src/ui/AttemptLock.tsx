import { useApp } from "../app/context"

/** Under a confirmation whose button is locked: why, and the one way out (read the order again). */
export function AttemptLock({ onReload, busy }: { onReload(): void; busy: boolean }) {
  const { t } = useApp()
  return (
    <>
      <p className="sheet-text" role="status">{t("act.locked")}</p>
      <button className="btn quiet" disabled={busy} onClick={onReload}>{t("act.reload")}</button>
    </>
  )
}
