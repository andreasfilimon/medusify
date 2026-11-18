import type { Translate } from "../lib/i18n"
import type { LogoutResult } from "../lib/session"

/** What the login screen tells after signing out: leftovers that could not be removed from here. */
export function LogoutNotice({ t, note }: { t: Translate; note: LogoutResult | null }) {
  if (!note) return null
  return (
    <>
      {note.pushStillAt.length ? <p className="notice">{t("more.logoutRemaining", { names: note.pushStillAt.map((s) => s.name).join(", ") })}</p> : null}
      {note.sessionStillOpen ? <p className="notice">{t("more.logoutSessionOpen")}</p> : null}
    </>
  )
}
