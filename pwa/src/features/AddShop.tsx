import { useId, useState, type SubmitEvent } from "react"
import { useApp } from "../app/context"
import { probeShop } from "../lib/api"
import type { Key } from "../lib/i18n"
import { defaultShopName, normalizeShopUrl, nextColor, shopIdFromOrigin } from "../lib/shops"
import type { Shop } from "../lib/types"
import { FieldError } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { LoginFlow } from "./LoginFlow"

export function AddShop({ onClose }: { onClose(): void }) {
  const { t, shops, registerNewShop } = useApp()
  const [address, setAddress] = useState("")
  const [error, setError] = useState<{ key: Key; vars?: Record<string, string> } | null>(null)
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<Shop | null>(null)
  const errId = useId()

  async function check(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const norm = normalizeShopUrl(address)
    if (!norm.ok) return setError({ key: `add.err.${norm.reason}` as Key })
    if (shops.some((s) => s.url === norm.origin)) return setError({ key: "add.exists" })
    setBusy(true)
    const res = await probeShop(norm.origin)
    setBusy(false)
    switch (res.kind) {
      case "medusa":
        return setFound({ id: shopIdFromOrigin(norm.origin), url: norm.origin, name: defaultShopName(norm.origin), color: nextColor(shops), home: false })
      case "unreachable":
        return setError({ key: "add.err.unreachable" })
      case "cors":
        return setError({ key: "add.err.cors", vars: { origin: location.origin } })
      case "preauth":
        return setError({ key: "add.err.preauth" })
      case "not-medusa":
        return setError({ key: "add.err.notMedusa" })
    }
  }

  if (found) {
    return (
      <div className="screen">
        <NavBar back={{ label: t("add.title"), onClick: () => setFound(null) }} />
        <LoginFlow
          shop={found}
          onBack={onClose}
          onDone={(shop) => {
            void registerNewShop(shop)
            onClose()
          }}
        />
      </div>
    )
  }
  return (
    <div className="screen">
      <NavBar back={{ label: t("tab.more"), onClick: onClose }} title={t("add.title")} />
      <main className="scroll">
        <form className="form" onSubmit={check} noValidate>
          <label className="field">
            <span>{t("add.address")}</span>
            <input type="url" name="shop" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="url" enterKeyHint="go" placeholder={t("add.example")} value={address} onChange={(e) => setAddress(e.target.value)} aria-invalid={!!error} aria-describedby={error ? errId : undefined} />
          </label>
          {error ? <FieldError id={errId}>{t(error.key, error.vars)}</FieldError> : null}
          <button className="btn primary form-submit" type="submit" disabled={busy || !address.trim()}>
            {busy ? t("add.checking") : t("add.check")}
          </button>
        </form>
      </main>
    </div>
  )
}
