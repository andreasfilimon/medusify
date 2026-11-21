import { useState } from "react"
import { Link, useLocation } from "wouter"
import pkg from "../../package.json"
import { useApp } from "../app/context"
import { InstallHint } from "../features/InstallHint"
import { PushKinds } from "../features/PushKinds"
import type { LangPref, ThemePref } from "../lib/prefs"
import { Icon } from "../ui/Icon"
import { Monogram, Section, Segmented } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { Scroll } from "../ui/Scroll"
import { Sheet } from "../ui/Sheet"
import { useToast } from "../ui/Toast"

export function More() {
  const { t, shops, dropShop, logout, langPref, setLangPref, themePref, setThemePref, pushSupport, pushOn, enableNotifications, sendTestPush } = useApp()
  const [, navigate] = useLocation()
  const toast = useToast()
  const [removing, setRemoving] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const home = shops.find((s) => s.home)
  const target = shops.find((s) => s.id === removing)

  async function enable() {
    setBusy(true)
    try {
      const res = await enableNotifications()
      if (res.kind === "failed")
        toast.show(res.error === "sw-timeout" ? t("more.pushSwTimeout") : t("more.pushShopFailed", { name: shops.map((s) => s.name).join(", ") }), { error: true })
    } catch {
      toast.show(t("more.pushSwTimeout"), { error: true })
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    try {
      const r = await sendTestPush()
      if (r.sent === 0) toast.show(t("more.pushTestNone"), { error: true })
      else toast.show(r.sent === 1 ? t("more.pushTestOk", { n: r.sent }) : t("more.pushTestOkMany", { n: r.sent }))
    } catch {
      toast.show(t("more.pushTestNone"), { error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <NavBar title={t("more.title")} />
      <Scroll heading={{ title: t("more.title") }}>
        <div className="group">
          <Link className="row single" href="/customers">
            <Icon name="users" size="sm" />
            <span className="row-main"><span className="row-title reg">{t("cust.title")}</span></span>
            <Icon name="caret-right" size="sm" />
          </Link>
          <Link className="row single" href="/discounts">
            <Icon name="tag" size="sm" />
            <span className="row-main"><span className="row-title reg">{t("disc.title")}</span></span>
            <Icon name="caret-right" size="sm" />
          </Link>
        </div>
        <Section id="shops" title={t("more.shops")}>
          <div className="group">
            {shops.map((s) => (
              <div className="row" key={s.id}>
                <Monogram shop={s} />
                <span className="row-main">
                  <span className="row-title">{s.name}</span>
                  <span className="row-sub">
                    {new URL(s.url).host}
                    {s.pushRegistered ? ` · ${t("more.pushShopOk")}` : ""}
                    {s.pushError ? ` · ${s.pushError === "sw-timeout" ? t("more.pushSwTimeout") : t("more.pushShopFailed", { name: s.name })}` : ""}
                    {!s.home && !s.token ? ` · ${t("more.needLogin")}` : ""}
                  </span>
                </span>
                {!s.home ? <button className="navbtn" onClick={() => setRemoving(s.id)}>{t("common.remove")}</button> : null}
              </div>
            ))}
            <Link className="row single" href="/more/add">
              <Icon name="plus" size="sm" />
              <span className="row-main"><span className="row-title reg tint">{t("more.addShop")}</span></span>
            </Link>
          </div>
        </Section>

        <Section id="notifications" title={t("more.notifications")}>
          <div className="group plain">
            {pushSupport === "needs-install" ? <p className="note">{t("more.pushNeedInstall")}</p> : null}
            {pushSupport === "unsupported" ? <p className="note">{t("more.pushUnsupported")}</p> : null}
            {pushSupport === "denied" ? <p className="note">{t("more.pushDenied")}</p> : null}
            {(pushSupport === "ask" || (pushSupport === "granted" && !pushOn)) ? (
              <div className="note">
                <p>{t("more.pushIntro")}</p>
                <button className="btn primary" onClick={() => void enable()} disabled={busy}>{t("more.pushEnable")}</button>
              </div>
            ) : null}
            {pushSupport === "granted" && pushOn ? (
              <>
                <p className="row single"><span className="row-main"><span className="row-title reg">{t("more.pushOn")}</span></span><Icon name="check" size="sm" /></p>
                <button className="row single" onClick={() => void test()} disabled={busy}>
                  <Icon name="bell-ringing" size="sm" />
                  <span className="row-main"><span className="row-title reg tint">{t("more.pushTest")}</span></span>
                </button>
              </>
            ) : null}
          </div>
          {pushSupport === "needs-install" ? <InstallHint signedIn /> : null}
        </Section>

        {pushSupport === "granted" && pushOn ? <PushKinds /> : null}

        <Section id="look" title={t("more.appearance")}>
          <div className="group plain pad">
            <Segmented<ThemePref> value={themePref} onChange={setThemePref} label={t("more.appearance")} options={[{ value: "system", label: t("more.theme.system") }, { value: "light", label: t("more.theme.light") }, { value: "dark", label: t("more.theme.dark") }]} />
          </div>
        </Section>
        <Section id="lang" title={t("more.language")}>
          <div className="group plain pad">
            <Segmented<LangPref> value={langPref} onChange={setLangPref} label={t("more.language")} options={[{ value: "auto", label: t("more.lang.auto") }, { value: "de", label: "Deutsch" }, { value: "en", label: "English" }]} />
          </div>
        </Section>

        <Section id="account" title={t("more.account")}>
          <div className="group plain">
            {home ? <p className="row single"><span className="row-main"><span className="row-title reg">{t("more.signedInAt", { name: home.name })}</span></span></p> : null}
            <button
              className="row single danger-row"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await logout()
                } finally {
                  setBusy(false)
                }
                navigate("/", { replace: true })
              }}
            >
              <span className="row-main"><span className="row-title reg">{shops.length > 1 ? t("more.logoutAll") : t("more.logout")}</span></span>
            </button>
          </div>
        </Section>

        <Section id="about" title={t("more.about")}>
          <div className="group plain">
            <p className="row single"><span className="row-main"><span className="row-title reg">Medusify</span></span><span className="num quiet">{t("more.version", { v: pkg.version })}</span></p>
          </div>
          <p className="foot">{t("more.licenses")}</p>
        </Section>
      </Scroll>

      {target ? (
        <Sheet title={t("more.removeShop")} onClose={() => setRemoving(null)}>
          <p className="sheet-text">{t("more.removeConfirm", { name: target.name })}</p>
          <button
            className="btn danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const res = await dropShop(target.id)
              setBusy(false)
              setRemoving(null)
              if (res.pushLeft) toast.show(t("more.logoutRemaining", { names: target.name }), { error: true })
            }}
          >
            {t("common.remove")}
          </button>
        </Sheet>
      ) : null}
    </div>
  )
}
