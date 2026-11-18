import type { Lang } from "./format"
import { detectLang } from "./i18n"

/**
 * Display preferences only (language, theme, selected shop, install hint). No credentials, no shop data.
 * The selected shop is cleared on logout; language and theme stay.
 */
export type LangPref = "auto" | Lang
export type ThemePref = "system" | "light" | "dark"

const K = { lang: "medusify.lang", theme: "medusify.theme", scope: "medusify.scope", hint: "medusify.installHint" }

const read = (k: string) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return null
  }
}
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k)
    else localStorage.setItem(k, v)
  } catch {
    /* storage unavailable: preferences just don't persist */
  }
}

export const prefs = {
  lang: (): LangPref => (read(K.lang) as LangPref | null) ?? "auto",
  setLang: (v: LangPref) => write(K.lang, v),
  theme: (): ThemePref => (read(K.theme) as ThemePref | null) ?? "system",
  setTheme: (v: ThemePref) => write(K.theme, v),
  scope: (): string | null => read(K.scope),
  setScope: (v: string | null) => write(K.scope, v),
  hintDismissedAt: (): number => Number(read(K.hint) ?? 0),
  dismissHint: (now: number) => write(K.hint, String(now)),
  clearSession: () => write(K.scope, null),
}

export function effectiveLang(pref: LangPref): Lang {
  return pref === "auto" ? detectLang(navigator.languages?.length ? navigator.languages : [navigator.language]) : pref
}

export const HINT_QUIET_MS = 30 * 24 * 3600 * 1000
