import { QueryCache, QueryClient, QueryClientProvider, useQueries, useQueryClient } from "@tanstack/react-query"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import * as api from "../lib/api"
import { syncBadge } from "../lib/badge"
import { ApiError, setTokenSink } from "../lib/api"
import { deviceTimezone, type Lang } from "../lib/format"
import { makeT, type Translate } from "../lib/i18n"
import { effectiveLang, prefs, type LangPref, type ThemePref } from "../lib/prefs"
import { enablePush, readPushEnv, pushSupport, registerAt, type PushSupport, type ShopPushResult } from "../lib/push"
import { logoutAll, removeForeignShop, type LogoutResult } from "../lib/session"
import { defaultShopName, nextColor, resolveScope, scopedShops, shopIdFromOrigin, upsertShop } from "../lib/shops"
import { loadShopsMigrated } from "../lib/boot"
import { SwTimeoutError, swReady } from "../lib/sw"
import { idbStore } from "../lib/store"
import type { Dashboard, Shop } from "../lib/types"

export type Status = "loading" | "login" | "ready" | "offline"

export type DashboardState = { shop: Shop; data?: Dashboard; error?: ApiError; updatedAt: number }

type AppCtx = {
  status: Status
  shops: Shop[]
  scope: string
  scoped: Shop[]
  setScope(id: string): void
  lang: Lang
  langPref: LangPref
  setLangPref(v: LangPref): void
  themePref: ThemePref
  setThemePref(v: ThemePref): void
  t: Translate
  now: number
  online: boolean
  dashboards: DashboardState[]
  toShip: Record<string, number>
  totalToShip: number
  refetchDashboards(): Promise<void>
  /** Stores a freshly authenticated shop (token for foreign shops) and moves the app to "ready" if it is the home shop. */
  saveShop(shop: Shop): Promise<void>
  dropShop(id: string): Promise<{ pushLeft: boolean }>
  logout(): Promise<LogoutResult>
  logoutNote: LogoutResult | null
  retryStart(): void
  pushSupport: PushSupport
  pushOn: boolean
  /** The push endpoint of this device, null when it has no subscription. */
  currentEndpoint(): Promise<string | null>
  enableNotifications(): Promise<{ kind: "denied" | "failed" | "ok"; results?: ShopPushResult[]; error?: string }>
  registerNewShop(shop: Shop): Promise<ShopPushResult | null>
  sendTestPush(): Promise<{ sent: number; failed: number; reachedShops: number }>
}

const Ctx = createContext<AppCtx | null>(null)
export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error("AppProvider missing")
  return c
}

let authErrorHandler: (shopId: string | undefined) => void = () => {}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (error instanceof ApiError && error.kind === "unauthorized") authErrorHandler(query.meta?.shopId as string | undefined)
    },
  }),
  defaultOptions: { queries: { retry: false, networkMode: "always", staleTime: 20_000, gcTime: 5 * 60_000, refetchOnWindowFocus: true } },
})

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Inner>{children}</Inner>
    </QueryClientProvider>
  )
}

function homeShopRecord(existing: Shop[]): Shop {
  const found = existing.find((s) => s.home)
  if (found) return { ...found, url: location.origin }
  return { id: shopIdFromOrigin(location.origin), url: location.origin, name: defaultShopName(location.origin), color: 1, home: true }
}

async function registrationOrNull() {
  if (!("serviceWorker" in navigator)) return null
  // Rejects with SwTimeoutError when no worker becomes ready: "unknown" is not the same as "no subscription".
  return (await swReady(navigator.serviceWorker.ready)) as unknown as import("../lib/push").PushRegistrationLike
}

function Inner({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status>("loading")
  const [shops, setShops] = useState<Shop[]>([])
  const shopsRef = useRef<Shop[]>([])
  const [scopePref, setScopePref] = useState<string | null>(prefs.scope())
  const [langPref, setLangPrefState] = useState<LangPref>(prefs.lang())
  const [themePref, setThemePrefState] = useState<ThemePref>(prefs.theme())
  const [now, setNow] = useState(() => Date.now())
  const [online, setOnline] = useState(navigator.onLine)
  const [logoutNote, setLogoutNote] = useState<LogoutResult | null>(null)
  const [pushTick, setPushTick] = useState(0)
  const [boot, setBoot] = useState(0)

  const lang = effectiveLang(langPref)
  const t = useMemo(() => makeT(lang), [lang])
  // True from the first step of a sign-out until the in-memory list has been reset. Anything that finishes in
  // between (a token refresh, an auth error, a push result) works on the old list and must not write it back.
  const closingRef = useRef(false)
  const commit = useCallback(async (next: Shop[]) => {
    if (closingRef.current) return
    shopsRef.current = next
    setShops(next)
    await idbStore.saveShops(next)
  }, [])

  // ---- boot: load shops, check the home session -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setStatus("loading")
      let stored: Shop[] = []
      try {
        stored = await loadShopsMigrated(idbStore)
      } catch {
        stored = []
      }
      const home = homeShopRecord(stored)
      const list = upsertShop(stored, home)
      shopsRef.current = list
      if (cancelled) return
      setScopePref(prefs.scope()) // the migration may have renamed the selected shop
      setShops(list)
      try {
        await api.shopFetch(home, "/admin/users/me?fields=id")
        if (cancelled) return
        setStatus("ready")
        if (home.name === defaultShopName(home.url)) {
          const name = await api.storeName(home)
          if (name && !cancelled) await commit(upsertShop(shopsRef.current, { ...shopsRef.current.find((s) => s.home)!, name }))
        }
      } catch (e) {
        if (cancelled) return
        setStatus(e instanceof ApiError && e.kind === "unauthorized" ? "login" : "offline")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [boot, commit])

  useEffect(() => {
    setTokenSink((shop, token) => {
      const known = shopsRef.current.find((s) => s.id === shop.id)
      if (!known || known.token === token) return // signed out or removed in the meantime: nothing to store
      void commit(shopsRef.current.map((s) => (s.id === shop.id ? { ...s, token } : s)))
    })
    authErrorHandler = (shopId) => {
      const shop = shopsRef.current.find((s) => s.id === shopId)
      if (!shop) return
      if (shop.home) setStatus("login")
      else void commit(shopsRef.current.map((s) => (s.id === shop.id ? { ...s, token: undefined } : s)))
    }
  }, [commit])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    addEventListener("online", up)
    addEventListener("offline", down)
    return () => {
      clearInterval(id)
      removeEventListener("online", up)
      removeEventListener("offline", down)
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    if (themePref === "system") document.documentElement.removeAttribute("data-theme")
    else document.documentElement.dataset.theme = themePref
  }, [lang, themePref])

  // ---- scope ------------------------------------------------------------------------------------------------
  const scope = resolveScope(shops, scopePref)
  const scoped = useMemo(() => scopedShops(shops, scope), [shops, scope])
  const setScope = useCallback((id: string) => {
    setScopePref(id)
    prefs.setScope(id)
  }, [])

  // ---- dashboards (also feed the tab badge and the shop menu) -----------------------------------------------
  const tz = useMemo(() => deviceTimezone(), [])
  const authedShops = useMemo(() => shops.filter((s) => s.home || s.token), [shops])
  const dashQueries = useQueries({
    queries: authedShops.map((shop) => ({
      queryKey: ["dashboard", shop.id, tz],
      queryFn: () => api.getDashboard(shop, tz),
      meta: { shopId: shop.id },
      enabled: status === "ready",
      refetchInterval: 60_000,
    })),
  })
  const dashboards: DashboardState[] = authedShops.map((shop, i) => {
    const q = dashQueries[i]
    return { shop, data: q?.data, error: q?.error instanceof ApiError ? q.error : q?.error ? new ApiError("network") : undefined, updatedAt: q?.dataUpdatedAt ?? 0 }
  })
  const toShip: Record<string, number> = {}
  for (const d of dashboards) if (d.data) toShip[d.shop.id] = d.data.to_ship
  const totalToShip = scoped.reduce((sum, s) => sum + (toShip[s.id] ?? 0), 0)
  // The number on the app icon: orders to ship over ALL shops (not only the selected one), set whenever the app has read them.
  const badgeSignature = dashboards.map((d) => `${d.shop.id}|${d.data?.shop_label ?? ""}|${d.data?.to_ship ?? "-"}`).join(";")
  useEffect(() => {
    if (status !== "ready") return
    const fresh = dashboards.flatMap((d) => (d.data ? [{ id: d.shop.id, label: d.data.shop_label ?? d.shop.name, n: d.data.to_ship }] : []))
    void syncBadge(fresh, authedShops.map((s) => s.id)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature carries everything the call reads
  }, [badgeSignature, status])
  const refetchDashboards = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["dashboard"] })
  }, [qc])

  // ---- shops ------------------------------------------------------------------------------------------------
  const saveShop = useCallback(
    async (shop: Shop) => {
      const color = shopsRef.current.find((s) => s.id === shop.id)?.color ?? nextColor(shopsRef.current)
      await commit(upsertShop(shopsRef.current, { ...shop, color }))
      if (shop.home) {
        setLogoutNote(null)
        setStatus("ready")
        void qc.invalidateQueries()
      }
    },
    [commit, qc],
  )

  const pushDeps = useMemo(() => ({ api, requestPermission: () => Notification.requestPermission(), registration: async () => (await registrationOrNull())! }), [])

  const currentEndpoint = useCallback(async () => {
    const reg = await registrationOrNull()
    return (await reg?.pushManager.getSubscription())?.endpoint ?? null
  }, [])

  const dropShop = useCallback(
    async (id: string) => {
      const shop = shopsRef.current.find((s) => s.id === id)
      if (!shop || shop.home) return { pushLeft: false }
      const res = await removeForeignShop(shop, shopsRef.current, { push: api, store: idbStore, currentEndpoint })
      shopsRef.current = res.shops
      setShops(res.shops)
      if (scopePref === id) setScope("all")
      qc.removeQueries({ predicate: (q) => q.meta?.shopId === id })
      return { pushLeft: res.pushLeft }
    },
    [currentEndpoint, qc, scopePref, setScope],
  )

  const logout = useCallback(async () => {
    closingRef.current = true
    try {
      await qc.cancelQueries()
      const result = await logoutAll(shopsRef.current, {
        push: api,
        endSession: api.endSession,
        store: idbStore,
        currentEndpoint,
        unsubscribeLocal: async () => {
          const reg = await registrationOrNull()
          await (await reg?.pushManager.getSubscription())?.unsubscribe()
        },
        clearSessionPrefs: () => prefs.clearSession(),
      })
      qc.clear()
      setScopePref(null)
      const fresh = homeShopRecord([])
      shopsRef.current = [fresh]
      setShops([fresh])
      setLogoutNote(result)
      setStatus("login")
      setPushTick((n) => n + 1)
      return result
    } finally {
      closingRef.current = false
    }
  }, [currentEndpoint, qc])

  // ---- push ---------------------------------------------------------------------------------------------------
  const [env, setEnv] = useState(readPushEnv)
  const [subscribed, setSubscribed] = useState(false)
  useEffect(() => {
    setEnv(readPushEnv())
    void (async () => setSubscribed(!!(await currentEndpoint().catch(() => null))))()
  }, [pushTick, currentEndpoint, status])
  const support = pushSupport(env)
  const pushOn = subscribed && support === "granted"

  const applyPushResults = useCallback(
    async (results: ShopPushResult[]) => {
      const next = shopsRef.current.map((s) => {
        const r = results.find((x) => x.shopId === s.id)
        return r ? { ...s, pushRegistered: r.ok, pushError: r.ok ? undefined : r.error } : s
      })
      await commit(next)
    },
    [commit],
  )

  const enableNotifications = useCallback(async () => {
    const targets = shopsRef.current.filter((s) => s.home || s.token)
    const out = await enablePush(targets, pushDeps)
    if (out.kind === "ok") await applyPushResults(out.results)
    setPushTick((n) => n + 1)
    if (out.kind === "ok") return { kind: "ok" as const, results: out.results }
    return out.kind === "failed" ? { kind: "failed" as const, error: out.error } : { kind: out.kind }
  }, [applyPushResults, pushDeps])

  /** A shop added after notifications were switched on joins automatically. */
  const registerNewShop = useCallback(
    async (shop: Shop) => {
      let sub: import("../lib/push").PushSubscriptionLike | null | undefined
      try {
        const reg = await registrationOrNull()
        sub = await reg?.pushManager.getSubscription()
      } catch (e) {
        if (!(e instanceof SwTimeoutError)) throw e
        const result = { shopId: shop.id, ok: false, error: "sw-timeout" }
        await applyPushResults([result])
        return result
      }
      if (!sub || Notification.permission !== "granted") return null
      const json = sub.toJSON()
      const key = sub.options?.applicationServerKey
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth || !key) return null
      const result = await registerAt(shop, new Uint8Array(key), { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }, api)
      await applyPushResults([result])
      return result
    },
    [applyPushResults],
  )

  const sendTestPush = useCallback(async () => {
    const targets = shopsRef.current.filter((s) => (s.home || s.token) && s.pushRegistered)
    const results = await Promise.allSettled(targets.map((s) => api.testPush(s)))
    let sent = 0
    let failed = 0
    let reached = 0
    for (const r of results) {
      if (r.status === "fulfilled") {
        sent += r.value.sent
        failed += r.value.failed
        reached += 1
      } else failed += 1
    }
    return { sent, failed, reachedShops: reached }
  }, [])

  const value: AppCtx = {
    status, shops, scope, scoped, setScope, lang, langPref, setLangPref: (v) => { prefs.setLang(v); setLangPrefState(v) },
    themePref, setThemePref: (v) => { prefs.setTheme(v); setThemePrefState(v) }, t, now, online, dashboards, toShip, totalToShip,
    refetchDashboards, saveShop, dropShop, logout, logoutNote, retryStart: () => setBoot((n) => n + 1),
    pushSupport: support, pushOn, currentEndpoint, enableNotifications, registerNewShop, sendTestPush,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
