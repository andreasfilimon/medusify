import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useId, useRef, useState, type SubmitEvent } from "react"
import { useLocation } from "wouter"
import { useApp } from "../app/context"
import { ALL_ALLOWED } from "../lib/actions"
import { fractionDigits } from "../lib/amount"
import * as api from "../lib/api"
import * as attempt from "../lib/attempt"
import { catalogErrorText } from "../lib/catalog-text"
import { customerTitle, type CustomerView } from "../lib/customers"
import { formatMoney } from "../lib/format"
import { EMPTY_ADDRESS, addLine, checkAddress, estimate, isEmail, manualOrderBody, setQuantity, type ManualAddress, type ManualLine } from "../lib/manual-order"
import { goBack } from "../lib/nav"
import { Icon } from "../ui/Icon"
import { Empty, FieldError, Skeleton } from "../ui/kit"
import { NavBar } from "../ui/Nav"
import { PickVariantSheet } from "../ui/PickVariantSheet"
import { Scroll } from "../ui/Scroll"
import { Stepper } from "../ui/Stepper"
import { useToast } from "../ui/Toast"

type Chosen = { id: string; title: string; email: string | null }

/**
 * An order taken by hand (phone, counter, mail): a customer or an email, the articles, shipping or pick-up, an address,
 * and whether the money is already there. The attempt keeps one key until its content changes, so a second tap after a
 * lost answer is the same order for the shop. Prices, taxes and price lists are the shop's: the sum here is the catalog's.
 */
export function NewOrder({ shopId }: { shopId: string }) {
  const { t, lang, shops, online } = useApp()
  const [, navigate] = useLocation()
  const qc = useQueryClient()
  const toast = useToast()
  const options = shops.filter((s) => s.home || s.token)
  const shop = options.find((s) => s.id === shopId)
  const perms = useQuery({ queryKey: ["permissions", shopId], queryFn: () => api.getPermissions(shop!), enabled: !!shop, staleTime: 5 * 60_000, retry: false })
  const allowed = perms.data ?? ALL_ALLOWED
  const setup = useQuery({ queryKey: ["order-setup", shopId], queryFn: () => api.orderSetup(shop!), enabled: !!shop, staleTime: 5 * 60_000, retry: false })

  const [who, setWho] = useState("")
  const [q, setQ] = useState("")
  const [customer, setCustomer] = useState<Chosen | null>(null)
  const [lines, setLines] = useState<ManualLine[]>([])
  const [picking, setPicking] = useState(false)
  const [regionPick, setRegionPick] = useState("")
  const [shipping, setShipping] = useState("")
  const [address, setAddress] = useState<ManualAddress>(EMPTY_ADDRESS)
  const [paid, setPaid] = useState(false)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const [checking, setChecking] = useState(false)
  const [, setTick] = useState(0)
  // After a lost answer nothing is sent until the shop has said what became of it (lib/attempt.ts): a changed form would
  // get a new key, and the shop would make a second order next to the first.
  const scope = shop ? `${shop.id}|manual-order` : ""
  const locked = !!shop && attempt.gate(scope, scope, "") === "locked"
  const ids = { who: useId(), region: useId(), ship: useId(), err: useId(), items: useId(), addr: useId() }

  useEffect(() => {
    const id = setTimeout(() => setQ(who.trim()), 300)
    return () => clearTimeout(id)
  }, [who])
  const found = useQuery({
    queryKey: ["customers", shopId, "pick", q],
    queryFn: () => api.listCustomers(shop!, { q, limit: 5 }),
    enabled: !!shop && !customer && q.length >= 2 && allowed.customers,
    retry: false,
  })

  const regions = setup.data?.regions ?? []
  const region = regions.find((r) => r.id === regionPick) ?? regions[0]
  const currency = region?.currency_code ?? ""
  const ships = (setup.data?.shipping_options ?? []).filter((o) => region && o.prices[region.id] != null)
  const ship = ships.find((o) => o.id === shipping) ?? null
  const shipPrice = ship && region ? (ship.prices[region.id] ?? null) : null
  const sum = estimate(lines, shipPrice, currency ? fractionDigits(currency) : 2)
  const email = customer ? customer.email : isEmail(who) ? who.trim() : null
  const addr = checkAddress(address)
  const problems = {
    who: customer || email ? null : who.trim() ? t("mo.emailInvalid") : t("mo.whoMissing"),
    items: lines.length ? null : t("mo.itemsMissing"),
    addr: addr.ok ? (ship && !addr.address ? t("mo.addressNeeded") : null) : t("mo.addressIncomplete"),
  }
  const ready = !problems.who && !problems.items && !problems.addr && !!region

  async function choose(c: CustomerView) {
    setCustomer({ id: c.id, title: customerTitle(c), email: c.email })
    setWho("")
    // the customer's default shipping address fills an empty form
    try {
      const detail = await api.getCustomer(shop!, c.id)
      const a = detail.addresses.find((x) => x.is_default_shipping) ?? detail.addresses[0]
      if (a) {
        setAddress((cur) =>
          Object.values(cur).some((v) => v.trim())
            ? cur
            : {
                first_name: a.first_name ?? "", last_name: a.last_name ?? "", company: a.company ?? "", address_1: a.address_1 ?? "",
                postal_code: a.postal_code ?? "", city: a.city ?? "", country_code: (a.country_code ?? "").toLowerCase(), phone: a.phone ?? "",
              }
        )
      }
    } catch {
      // no address then: the form stays as it is
    }
  }

  async function submit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault()
    setTouched(true)
    if (pending.current || !shop || !ready || !region || !addr.ok || locked) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const base = {
        region_id: region.id,
        customer_id: customer?.id ?? null,
        email: customer ? null : email,
        items: lines.map((l) => ({ variant_id: l.variant_id, quantity: l.quantity })),
        shipping_option_id: ship?.id ?? null,
        address: addr.address,
        paid: paid && allowed.mark_paid,
      }
      // The key lives in lib/attempt.ts, not in this screen: after a lost answer the merchant may leave and come back, and
      // the lock (and the key the shop is asked about) must still be there.
      const key = attempt.begin(scope, scope, JSON.stringify(base), "")
      const made = await api.createManualOrder(shop, manualOrderBody({ ...base, idempotency_key: key }))
      attempt.forget(scope)
      await opened(made)
    } catch (err) {
      const f = catalogErrorText(t, err)
      // A clear refusal settles this attempt; a lost answer locks the form until the shop is asked.
      if (f.unknown) attempt.lost(scope, false)
      else attempt.forget(scope)
      setError(f.text)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  /** The order is there (made now, or found after a lost answer): to it, with what the merchant needs to know. */
  async function opened(made: { order_id: string; display_id: number | null; replayed?: boolean; incomplete?: boolean }, found = false) {
    if (!shop) return
    await Promise.all([qc.invalidateQueries({ queryKey: ["orders"] }), qc.invalidateQueries({ queryKey: ["dashboard"] }), qc.invalidateQueries({ queryKey: ["customers"] }), qc.invalidateQueries({ queryKey: ["products"] })])
    const n = made.display_id ?? "?"
    toast.show(made.incomplete ? t("mo.incomplete", { n }) : found ? t("mo.already", { n }) : made.display_id ? t("mo.doneNumber", { n: made.display_id }) : t("mo.done"))
    navigate(`/orders/${encodeURIComponent(made.order_id)}?shop=${encodeURIComponent(shop.id)}`, { replace: true })
  }

  async function check() {
    const key = shop ? attempt.keyOf(scope) : null
    if (!shop || !key || checking) return
    setChecking(true)
    setError(null)
    try {
      const r = await api.manualOrderAttempt(shop, key)
      if (r.state === "none") {
        // nothing was made: the form is free again (the same content still goes with the same key)
        attempt.reread(scope)
        setTick((n) => n + 1)
      } else {
        attempt.forget(scope)
        await opened({ order_id: r.order_id, display_id: r.display_id, incomplete: r.state === "incomplete" }, true)
      }
    } catch (err) {
      setError(catalogErrorText(t, err).text)
    } finally {
      setChecking(false)
    }
  }

  const back = { label: t("nav.back"), onClick: () => goBack(navigate, "/orders") }
  const frame = (body: React.ReactNode) => (
    <div className="screen">
      <NavBar back={back} title={t("mo.title")} />
      <Scroll heading={{ title: t("mo.title"), subtitle: shop && options.length > 1 ? shop.name : undefined }}>{body}</Scroll>
    </div>
  )
  if (!shop) return frame(<Empty icon="storefront" title={t("prod.noShop")} />)
  if (perms.data && !allowed.manual_order) return frame(<Empty icon="lock-simple" title={t("prod.forbiddenTitle")} text={t("mo.noRight")} />)
  if (setup.isPending) return frame(<Skeleton rows={6} />)
  if (setup.isError) {
    return frame(<Empty icon="warning-circle" title={catalogErrorText(t, setup.error).text} action={<button className="btn soft inline" onClick={() => void setup.refetch()}>{t("common.retry")}</button>} />)
  }
  if (regions.length === 0) return frame(<Empty icon="storefront" title={t("mo.noRegion")} text={t("mo.noRegionText")} />)

  const show = (p: string | null) => (touched && p ? p : null)
  const money = (n: number) => formatMoney(n, currency, lang)
  const field = (key: keyof ManualAddress, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field">
      <label htmlFor={`${ids.addr}-${key}`}>{label}</label>
      <input
        id={`${ids.addr}-${key}`}
        type="text"
        name={key}
        value={address[key]}
        aria-invalid={touched && !addr.ok && addr.missing.includes(key)}
        onChange={(e) => setAddress((a) => ({ ...a, [key]: e.target.value }))}
        {...extra}
      />
    </div>
  )

  return frame(
    <>
      {options.length > 1 ? (
        <div className="chips" role="group" aria-label={t("prod.shop")}>
          {options.map((s) => (
            <button key={s.id} type="button" className="fchip" aria-pressed={s.id === shop.id} disabled={busy} onClick={() => navigate(`/orders/new/${encodeURIComponent(s.id)}`, { replace: true })}>
              {s.name}
            </button>
          ))}
        </div>
      ) : null}
      <form className="form new-order" onSubmit={submit} noValidate>
        <h2 className="form-head">{t("mo.customer")}</h2>
        {customer ? (
          <div className="group">
            <div className="row">
              <Icon name="user-circle" size="sm" />
              <span className="row-main">
                <span className="row-title">{customer.title}</span>
                {customer.email && customer.email !== customer.title ? <span className="row-sub">{customer.email}</span> : null}
              </span>
              <button type="button" className="btn small" onClick={() => setCustomer(null)} disabled={busy}>{t("mo.change")}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor={ids.who}>{allowed.customers ? t("mo.whoField") : t("mo.emailField")}</label>
              <input
                id={ids.who}
                type={allowed.customers ? "text" : "email"}
                name="who"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                value={who}
                onChange={(e) => setWho(e.target.value)}
                aria-invalid={!!show(problems.who)}
                aria-describedby={show(problems.who) ? `${ids.who}-e` : undefined}
              />
            </div>
            {show(problems.who) ? <FieldError id={`${ids.who}-e`}>{problems.who!}</FieldError> : null}
            {(found.data?.customers ?? []).length > 0 ? (
              <div className="group" aria-label={t("mo.matches")}>
                {found.data!.customers.map((c) => (
                  <button key={c.id} type="button" className="row" onClick={() => void choose(c)}>
                    <Icon name="user-circle" size="sm" />
                    <span className="row-main">
                      <span className="row-title">{customerTitle(c)}</span>
                      {c.email ? <span className="row-sub">{c.email}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            {email ? <p className="note">{t("mo.guest", { email })}</p> : null}
          </>
        )}

        <h2 className="form-head" id={ids.items}>{t("mo.items")}</h2>
        {lines.length > 0 ? (
          <div className="group" aria-labelledby={ids.items}>
            {lines.map((l) => (
              <div key={l.variant_id} className="row">
                <span className="row-main">
                  <span className="row-title">{l.title}</span>
                  <span className="row-sub">
                    {[l.variant, l.unit === null ? t("mo.noPrice") : `${l.quantity} × ${money(l.unit)}`].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <Stepper value={l.quantity} min={0} max={l.max ?? undefined} label={t("mo.count", { title: l.title })} onChange={(n) => setLines((cur) => setQuantity(cur, l.variant_id, n))} />
              </div>
            ))}
          </div>
        ) : null}
        <button type="button" className="btn soft" onClick={() => setPicking(true)} disabled={busy}>
          <Icon name="plus" size="sm" />{t("mo.addItem")}
        </button>
        {show(problems.items) ? <FieldError id={`${ids.items}-e`}>{problems.items!}</FieldError> : null}

        <h2 className="form-head">{t("mo.delivery")}</h2>
        {regions.length > 1 ? (
          <div className="field">
            <label htmlFor={ids.region}>{t("mo.region")}</label>
            <select id={ids.region} value={region!.id} onChange={(e) => { setRegionPick(e.target.value); setShipping(""); setLines([]) }} disabled={busy}>
              {regions.map((r) => <option key={r.id} value={r.id}>{`${r.name} (${r.currency_code.toUpperCase()})`}</option>)}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={ids.ship}>{t("mo.shipping")}</label>
          <select id={ids.ship} value={ship?.id ?? ""} onChange={(e) => setShipping(e.target.value)} disabled={busy}>
            <option value="">{t("mo.noShipping")}</option>
            {ships.map((o) => <option key={o.id} value={o.id}>{`${o.name} · ${money(o.prices[region!.id]!)}`}</option>)}
          </select>
        </div>
        <fieldset className="address">
          <legend>{ship ? t("mo.address") : t("mo.addressOptional")}</legend>
          {field("first_name", t("mo.firstName"), { autoComplete: "off" })}
          {field("last_name", t("mo.lastName"), { autoComplete: "off" })}
          {field("company", t("mo.company"), { autoComplete: "off" })}
          {field("address_1", t("mo.street"), { autoComplete: "off" })}
          {field("postal_code", t("mo.postcode"), { autoComplete: "off", inputMode: "numeric" })}
          {field("city", t("mo.city"), { autoComplete: "off" })}
          <div className="field">
            <label htmlFor={`${ids.addr}-country`}>{t("mo.country")}</label>
            <select id={`${ids.addr}-country`} value={address.country_code} aria-invalid={touched && !addr.ok && addr.missing.includes("country_code")} onChange={(e) => setAddress((a) => ({ ...a, country_code: e.target.value }))}>
              <option value="">{t("mo.countryPick")}</option>
              {region!.countries.map((c) => <option key={c.iso_2} value={c.iso_2}>{c.name}</option>)}
            </select>
          </div>
          {field("phone", t("mo.phone"), { autoComplete: "off", inputMode: "tel" })}
        </fieldset>
        {show(problems.addr) ? <FieldError id={`${ids.addr}-e`}>{problems.addr!}</FieldError> : null}

        {allowed.mark_paid ? (
          <button type="button" className="switch" role="switch" aria-checked={paid} onClick={() => setPaid((v) => !v)} disabled={busy}>
            <span>{t("mo.paid")}</span>
            <span className="track" aria-hidden="true" />
          </button>
        ) : null}

        <div className="group sum" aria-live="polite">
          <div className="row"><span className="row-main">{t("mo.sumItems")}</span><span className="row-end">{money(sum.items)}</span></div>
          <div className="row"><span className="row-main">{t("mo.sumShipping")}</span><span className="row-end">{ship ? money(shipPrice ?? 0) : t("mo.none")}</span></div>
          <div className="row strong"><span className="row-main">{t("mo.sumTotal")}</span><span className="row-end">{sum.complete ? money(sum.total) : t("mo.noPrice")}</span></div>
        </div>
        <p className="note">{t("mo.note")}</p>
        {error ? <FieldError id={ids.err}>{error}</FieldError> : null}
        {locked ? (
          <>
            <p className="sheet-text" role="status">{t("mo.locked")}</p>
            <button type="button" className="btn soft" onClick={() => void check()} disabled={checking || !online}>{checking ? t("common.loading") : t("mo.check")}</button>
          </>
        ) : null}
        <button type="submit" className="btn primary form-submit" disabled={busy || !online || locked || (touched && !ready)}>{busy ? t("common.loading") : t("mo.create")}</button>
      </form>
      {picking ? <PickVariantSheet shop={shop} currency={currency} onPick={(l) => setLines((cur) => addLine(cur, l))} onClose={() => setPicking(false)} /> : null}
    </>
  )
}
