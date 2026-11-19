import { useState } from "react"
import { useApp } from "../app/context"
import { HINT_QUIET_MS, prefs } from "../lib/prefs"
import { readPushEnv } from "../lib/push"
import { Icon } from "../ui/Icon"

/** iPhone/iPad Safari only, not in the installed app. Closed to one line until tapped; the cross keeps it quiet for 30 days. */
export function InstallHint({ signedIn }: { signedIn: boolean }) {
  const { t, now } = useApp()
  const [hidden, setHidden] = useState(() => now - prefs.hintDismissedAt() < HINT_QUIET_MS)
  if (hidden || !readPushEnv().iosBrowserTab) return null
  return (
    <section className="band install" aria-labelledby="install-h">
      <details>
        <summary>
          <Icon name="export" />
          <h2 id="install-h">{t("install.title")}</h2>
          <span className="chev" aria-hidden="true"><Icon name="caret-down" size="xs" /></span>
        </summary>
        <p>{signedIn ? t("install.why") : t("login.install")}</p>
        <ol className="steps">
          <li>{t("install.step1")}</li>
          <li>{t("install.step2")}</li>
          <li>{t("install.step3")}</li>
        </ol>
      </details>
      <button className="navbtn install-close" aria-label={t("common.close")} onClick={() => { prefs.dismissHint(Date.now()); setHidden(true) }}>
        <Icon name="x" size="sm" />
      </button>
    </section>
  )
}
