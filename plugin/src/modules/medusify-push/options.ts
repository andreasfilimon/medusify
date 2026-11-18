import type {
  MedusifyLocale,
  MedusifyPushOptions,
  ResolvedMedusifyPushOptions,
} from "./types"

const SUBJECT_RE = /^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/i
// VAPID keys are URL-safe base64: public = 65 bytes (87 chars), private = 32 bytes (43 chars).
const B64URL_RE = /^[A-Za-z0-9_-]+$/

/**
 * Pure validation of the plugin options. Never throws: a shop must keep running when
 * push is misconfigured. Problems are reported (loader logs them) and push is disabled.
 */
export function resolveOptions(
  options: MedusifyPushOptions | undefined
): ResolvedMedusifyPushOptions {
  const problems: string[] = []
  const vapid = options?.vapid
  const publicKey = vapid?.publicKey?.trim()
  const privateKey = vapid?.privateKey?.trim()
  const subject = vapid?.subject?.trim()

  if (!publicKey) {
    problems.push("vapid.publicKey is missing")
  } else if (!B64URL_RE.test(publicKey) || publicKey.length !== 87) {
    problems.push("vapid.publicKey is not a valid VAPID public key (87 url-safe base64 chars)")
  }
  if (!privateKey) {
    problems.push("vapid.privateKey is missing")
  } else if (!B64URL_RE.test(privateKey) || privateKey.length !== 43) {
    problems.push("vapid.privateKey is not a valid VAPID private key (43 url-safe base64 chars)")
  }
  if (!subject) {
    problems.push("vapid.subject is missing")
  } else if (!SUBJECT_RE.test(subject)) {
    problems.push("vapid.subject must be a mailto: address or an https:// URL")
  }

  const locale: MedusifyLocale = options?.locale === "en" ? "en" : "de"
  if (options?.locale && options.locale !== "de" && options.locale !== "en") {
    problems.push(`locale "${options.locale}" is not supported, using "de"`)
  }

  const enabled = !!publicKey && !!privateKey && !!subject &&
    problems.filter((p) => !p.startsWith("locale")).length === 0

  return {
    enabled,
    problems,
    vapid: enabled
      ? { publicKey: publicKey!, privateKey: privateKey!, subject: subject! }
      : null,
    storeLabel: options?.storeLabel?.trim() || "Shop",
    locale,
    pwaDir: options?.pwaDir?.trim() || null,
  }
}
