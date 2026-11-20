import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState, type ChangeEvent, type SubmitEvent } from "react"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import { ALL_ALLOWED } from "../lib/actions"
import { checkAmount, fractionDigits } from "../lib/amount"
import * as api from "../lib/api"
import { MAX_STOCK, parseCount } from "../lib/catalog"
import { catalogErrorText } from "../lib/catalog-text"
import { shrinkPhoto } from "../lib/image"
import { goBack } from "../lib/nav"
import { Icon } from "../ui/Icon"
import { Empty, FieldError, Segmented } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { MAX_PRICE } from "../ui/PriceSheet"
import { Scroll } from "../ui/Scroll"
import { useToast } from "../ui/Toast"

export const MAX_TITLE = 200

type Status = "draft" | "published"

/**
 * Quick create: a photo, a name, a price and a count become one product with one variant. The attempt has one key until the
 * content changes, and the photo is uploaded once: a second tap after a lost answer is the same product for the shop, not
 * another one. Everything beyond that (options, more variants, texts) stays in the Medusa admin.
 */
export function NewProduct({ shopId }: { shopId: string }) {
  const { t, shops, online } = useApp()
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const toast = useToast()
  const shop = shops.find((s) => s.id === shopId && (s.home || s.token))
  const perms = useQuery({ queryKey: ["permissions", shopId], queryFn: () => api.getPermissions(shop!), enabled: !!shop, staleTime: 5 * 60_000, retry: false })
  const allowed = perms.data ?? ALL_ALLOWED
  const places = useQuery({ queryKey: ["locations", shopId], queryFn: () => api.stockLocations(shop!), enabled: !!shop, staleTime: 5 * 60_000 })
  const currencies = useQuery({ queryKey: ["currencies", shopId], queryFn: () => api.storeCurrencies(shop!), enabled: !!shop, staleTime: 5 * 60_000 })
  const [name, setName] = useState("")
  const [priceRaw, setPriceRaw] = useState("")
  const [currencyPick, setCurrencyPick] = useState("")
  const [countRaw, setCountRaw] = useState("1")
  const [placePick, setPlacePick] = useState("")
  const [status, setStatus] = useState<Status>("draft")
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const attempt = useRef<{ content: string; key: string } | null>(null)
  const uploaded = useRef<{ blob: Blob; url: string } | null>(null)
  const nameId = useId(), priceId = useId(), countId = useId(), placeId = useId(), currencyId = useId(), errId = useId()

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url) }, [photo])

  const place = placePick || places.data?.[0]?.id || ""
  const currency = currencyPick || currencies.data?.[0] || ""
  const title = name.trim()
  const price = currency ? checkAmount(priceRaw, currency, MAX_PRICE) : ({ ok: false, reason: "empty" } as const)
  const count = parseCount(countRaw)
  const ready = title.length > 0 && title.length <= MAX_TITLE && price.ok && count !== null && !!place && !!currency

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    setPhotoBusy(true)
    setPhotoError(null)
    try {
      const blob = await shrinkPhoto(file)
      setPhoto({ blob, url: URL.createObjectURL(blob) })
    } catch {
      setPhotoError(t("new.photoFailed"))
    } finally {
      setPhotoBusy(false)
    }
  }

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (pending.current || !shop || !ready || !price.ok || count === null) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      let image_url: string | undefined
      if (photo) {
        if (uploaded.current?.blob !== photo.blob) uploaded.current = { blob: photo.blob, url: await api.uploadPhoto(shop, photo.blob) }
        image_url = uploaded.current.url
      }
      const content = JSON.stringify([title, price.value, currency, count, place, status, image_url ?? ""])
      if (attempt.current?.content !== content) attempt.current = { content, key: crypto.randomUUID() }
      const made = await api.createProduct(shop, { title, status, price: { currency_code: currency, amount: price.value }, stock: { location_id: place, quantity: count }, image_url, idempotency_key: attempt.current.key })
      attempt.current = null
      await Promise.all([qc.invalidateQueries({ queryKey: ["products"] }), qc.invalidateQueries({ queryKey: ["product"] })])
      toast.show(t("new.done"))
      navigate(`/products/${encodeURIComponent(shop.id)}/${encodeURIComponent(made.product_id)}`, { replace: true })
    } catch (err) {
      const f = catalogErrorText(t, err)
      // A clear refusal settles this attempt; a lost answer keeps the key so the next tap is the same product.
      if (!f.unknown) attempt.current = null
      setError(f.text)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/products") }
  if (shop && perms.data && !allowed.product_create) {
    return (
      <div className="screen">
        <NavBar back={back} title={t("new.title")} />
        <Scroll heading={{ title: t("new.title") }}><Empty icon="lock-simple" title={t("prod.forbiddenTitle")} text={t("new.noRight")} /></Scroll>
      </div>
    )
  }
  const priceProblem = touched && !price.ok && currency ? t(`prod.price.${price.reason}` as "prod.price.empty", { n: fractionDigits(currency) }) : null
  const noPlaces = !places.isPending && (places.data ?? []).length === 0
  const noCurrency = !currencies.isPending && (currencies.data ?? []).length === 0

  return (
    <div className="screen">
      <NavBar back={back} title={t("new.title")} />
      <Scroll heading={{ title: t("new.title"), subtitle: shop && shops.length > 1 ? shop.name : undefined }}>
        <form className="form new-product" onSubmit={submit} noValidate>
          {allowed.upload ? (
            <div className="photo">
              <span className="photo-tile" aria-hidden={!photo}>
                {photo ? <img src={photo.url} alt={t("new.photoAlt")} /> : <Icon name="image-square" size="lg" />}
              </span>
              <span className="photo-actions">
                <label className="btn soft inline">
                  <Icon name="camera" size="sm" />{t("new.takePhoto")}
                  <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e)} />
                </label>
                <label className="btn quiet inline">
                  {t("new.pickPhoto")}
                  <input type="file" accept="image/*" hidden onChange={(e) => void pick(e)} />
                </label>
                {photo ? <button type="button" className="btn quiet inline" onClick={() => { setPhoto(null); uploaded.current = null }}>{t("new.removePhoto")}</button> : null}
              </span>
              {photoBusy ? <p className="note" role="status">{t("common.loading")}</p> : null}
              {photoError ? <FieldError id="photo-err">{photoError}</FieldError> : null}
            </div>
          ) : <p className="note">{t("new.noRightUpload")}</p>}

          <div className="field">
            <label htmlFor={nameId}>{t("new.name")}</label>
            <input id={nameId} type="text" name="title" autoComplete="off" autoCapitalize="sentences" enterKeyHint="next" maxLength={MAX_TITLE} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={touched && title.length === 0} />
          </div>
          {touched && title.length === 0 ? <FieldError id="name-err">{t("new.nameEmpty")}</FieldError> : null}

          {(currencies.data ?? []).length > 1 ? (
            <div className="field">
              <label htmlFor={currencyId}>{t("new.currency")}</label>
              <select id={currencyId} value={currency} onChange={(e) => setCurrencyPick(e.target.value)}>
                {(currencies.data ?? []).map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            </div>
          ) : null}
          {noCurrency ? <FieldError id="cur-err">{t("new.noCurrency")}</FieldError> : null}

          <div className="field">
            <label htmlFor={priceId}>{t("prod.priceField", { currency: (currency || "—").toUpperCase() })}</label>
            <input id={priceId} type="text" name="price" inputMode="decimal" autoComplete="off" enterKeyHint="next" value={priceRaw} onChange={(e) => setPriceRaw(e.target.value)} aria-invalid={!!priceProblem} aria-describedby={priceProblem ? errId : undefined} />
          </div>
          {priceProblem ? <FieldError id={errId}>{priceProblem}</FieldError> : null}

          <div className="field">
            <label htmlFor={countId}>{t("new.count")}</label>
            <input id={countId} type="text" name="count" inputMode="numeric" autoComplete="off" enterKeyHint="done" value={countRaw} onChange={(e) => setCountRaw(e.target.value)} aria-invalid={touched && count === null} />
          </div>
          {touched && count === null ? <FieldError id="count-err">{t("prod.countInvalid", { max: MAX_STOCK.toLocaleString("de-AT") })}</FieldError> : null}
          {(places.data ?? []).length > 1 ? (
            <div className="field">
              <label htmlFor={placeId}>{t("new.place")}</label>
              <select id={placeId} value={place} onChange={(e) => setPlacePick(e.target.value)}>
                {(places.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          ) : null}
          {noPlaces ? <FieldError id="place-err">{t("new.noPlace")}</FieldError> : null}

          <div className="field">
            <span>{t("new.status")}</span>
            <Segmented<Status> value={status} label={t("new.status")} onChange={setStatus} options={[{ value: "draft", label: t("prod.status.draft") }, { value: "published", label: t("new.published") }]} />
            <p className="help">{status === "draft" ? t("new.draftHelp") : t("new.publishedHelp")}</p>
          </div>

          {error ? <FieldError id="create-err">{error}</FieldError> : null}
          <button type="submit" className="btn primary" disabled={busy || photoBusy || !online || (touched && !ready)}>{busy ? t("common.loading") : t("new.create")}</button>
        </form>
      </Scroll>
    </div>
  )
}
