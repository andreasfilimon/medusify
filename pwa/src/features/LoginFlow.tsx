import { useEffect, useId, useRef, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import * as api from "../lib/api"
import { ApiError, type LoginMethods } from "../lib/api"
import type { Key } from "../lib/i18n"
import { callbackUrl, hasAdminActor, readCallback, rememberState, stateFromLocation, stripCallbackFromUrl, takeState } from "../lib/oauth"
import type { Shop } from "../lib/types"
import { FieldError } from "../ui/kit"
import { InstallHint } from "./InstallHint"
import { LogoutNotice } from "./LogoutNotice"

type Step = { kind: "credentials" } | { kind: "mfa"; token: string; challengeId: string; methods: string[]; recovery: boolean }

/** Sign-in at one shop: email and password, then the MFA code Medusa asks for. Credentials never leave this component. */
export function LoginFlow({ shop, expired, onDone, onBack }: { shop: Shop; expired?: boolean; onDone(shop: Shop): void; onBack?: () => void }) {
  const { t, saveShop, logoutNote } = useApp()
  const [step, setStep] = useState<Step>({ kind: "credentials" })
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [reveal, setReveal] = useState(false)
  const [code, setCode] = useState("")
  const [error, setError] = useState<Key | null>(null)
  const [busy, setBusy] = useState(false)
  const errId = useId()
  const pwId = useId()
  const pending = useRef(false)
  const [methods, setMethods] = useState<LoginMethods | null>(null)
  const [leaving, setLeaving] = useState(false)
  const handledCallback = useRef(false)

  useEffect(() => {
    let live = true
    void api.loginMethods(shop).then((m) => live && setMethods(m))
    return () => {
      live = false
    }
  }, [shop])

  // Return from Google: only the home shop receives it (the callback address is on its own origin).
  useEffect(() => {
    if (!shop.home || handledCallback.current) return
    const cb = readCallback(location.pathname, location.search)
    if (!cb) return
    handledCallback.current = true
    stripCallbackFromUrl()
    const expected = takeState()
    if (cb.error) return setError("login.google.cancelled")
    if (!cb.code || !cb.state || cb.state !== expected) return setError("login.google.failed")
    pending.current = true
    setBusy(true)
    setLeaving(true)
    api
      .googleCallback(shop, cb.code, cb.state)
      .then(async (res) => {
        if (res.kind === "mfa") return setStep({ kind: "mfa", token: res.token, challengeId: res.challengeId, methods: res.methods, recovery: false })
        if (!hasAdminActor(res.token)) return setError("login.google.notAllowed")
        await finish(res.token)
      })
      .catch(() => setError("login.google.failed"))
      .finally(() => {
        pending.current = false
        setBusy(false)
        setLeaving(false)
      })
    // finish() only depends on props that do not change during this one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop])

  async function startGoogle() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setLeaving(true)
    setError(null)
    try {
      const target = await api.googleStart(shop, callbackUrl(location.origin))
      const state = stateFromLocation(target)
      if (!state) throw new ApiError("rejected")
      rememberState(state)
      location.assign(target)
    } catch (err) {
      fail(err, false)
      pending.current = false
      setBusy(false)
      setLeaving(false)
    }
  }

  const fail = (e: unknown, mfa: boolean) => {
    if (e instanceof ApiError) {
      if (e.status === 429) return setError("login.err.limit")
      if (e.kind === "network") return setError("login.err.network")
      if (e.kind === "unauthorized" || e.status === 400) return setError(mfa ? "login.err.mfa" : "login.err.credentials")
    }
    setError("login.err.generic")
  }

  async function finish(token: string) {
    let next: Shop
    if (shop.home) {
      await api.startSession(shop, token) // the cookie is httpOnly; the JWT is dropped right here
      next = { ...shop }
    } else {
      next = { ...shop, token }
    }
    const name = await api.storeName(next)
    if (name) next.name = name
    await saveShop(next)
    onDone(next)
  }

  async function submitCredentials(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await api.login(shop, email.trim(), password)
      if (res.kind === "ok") await finish(res.token)
      else setStep({ kind: "mfa", token: res.token, challengeId: res.challengeId, methods: res.methods, recovery: false })
    } catch (err) {
      fail(err, false)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  async function submitMfa(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    if (step.kind !== "mfa" || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const token = await api.verifyMfa(shop, step.challengeId, step.token, step.recovery ? "recovery_code" : "totp", code.replace(/\s+/g, ""))
      await finish(token)
    } catch (err) {
      fail(err, true)
      setCode("")
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const host = new URL(shop.url).host
  return (
    <div className="login">
      <main className="scroll">
        <div className="largetitle login-title">
          <h1>{step.kind === "mfa" ? t("login.mfa.title") : t("login.title")}</h1>
          <p>{t("login.at", { host })}</p>
        </div>
        {expired ? <p className="notice">{t("login.expired")}</p> : null}
        <LogoutNotice t={t} note={logoutNote} />

        {step.kind === "credentials" && methods && !methods.password && !(methods.google && shop.home) ? (
          <p className="notice">{t("login.methods.none")}</p>
        ) : null}
        {step.kind === "credentials" && methods?.google && shop.home ? (
          <div className="form">
            <button type="button" className="btn primary google-btn" onClick={() => void startGoogle()} disabled={busy}>
              {leaving ? t("login.google.wait") : t("login.google")}
            </button>
            {methods.password ? <p className="divider" role="separator">{t("login.or")}</p> : null}
          </div>
        ) : null}
        {step.kind === "credentials" && methods?.google && shop.home && !methods.password && error ? <FieldError id={errId}>{t(error)}</FieldError> : null}
        {step.kind === "credentials" && methods?.password ? (
          <form className="form" onSubmit={submitCredentials} noValidate>
            <label className="field">
              <span>{t("login.email")}</span>
              <input type="email" name="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" enterKeyHint="next" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} aria-describedby={error ? errId : undefined} required />
            </label>
            <div className="field">
              <label htmlFor={pwId}>{t("login.password")}</label>
              <span className="pw">
                <input id={pwId} type={reveal ? "text" : "password"} name="password" autoComplete="current-password" enterKeyHint="go" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} aria-describedby={error ? errId : undefined} required />
                <button type="button" className="navbtn" onClick={() => setReveal((v) => !v)} aria-pressed={reveal}>
                  {reveal ? t("login.hide") : t("login.show")}
                </button>
              </span>
            </div>
            {error ? <FieldError id={errId}>{t(error)}</FieldError> : null}
            <button className="btn primary form-submit" type="submit" disabled={busy || !email || !password}>
              {t("login.submit")}
            </button>
          </form>
        ) : step.kind === "mfa" ? (
          <form className="form" onSubmit={submitMfa} noValidate>
            <p className="form-lead">{step.recovery ? t("login.mfa.recoveryPrompt") : t("login.mfa.prompt")}</p>
            <label className="field">
              <span>{step.recovery ? t("login.mfa.recoveryCode") : t("login.mfa.code")}</span>
              <input
                key={step.recovery ? "rc" : "otp"}
                type="text"
                name="code"
                autoComplete="one-time-code"
                inputMode={step.recovery ? "text" : "numeric"}
                pattern={step.recovery ? undefined : "[0-9]*"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={step.recovery ? 40 : 6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? errId : undefined}
                autoFocus
              />
            </label>
            {error ? <FieldError id={errId}>{t(error)}</FieldError> : null}
            <button className="btn primary form-submit" type="submit" disabled={busy || (step.recovery ? code.length < 4 : code.length !== 6)}>
              {t("login.mfa.submit")}
            </button>
            {step.methods.includes("recovery_code") ? (
              <button type="button" className="linkbtn" onClick={() => { setStep({ ...step, recovery: !step.recovery }); setCode(""); setError(null) }}>
                {step.recovery ? t("login.mfa.useTotp") : t("login.mfa.useRecovery")}
              </button>
            ) : null}
            <button type="button" className="linkbtn" onClick={() => { setStep({ kind: "credentials" }); setCode(""); setError(null) }}>
              {t("login.back")}
            </button>
          </form>
        ) : null}
        {onBack ? (
          <button type="button" className="linkbtn" onClick={onBack}>
            {t("common.cancel")}
          </button>
        ) : null}
        {shop.home ? <InstallHint signedIn={false} /> : null}
      </main>
    </div>
  )
}
