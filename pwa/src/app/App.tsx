import { useEffect, useRef } from "react"
import { flushSync } from "react-dom"
import { Redirect, Route, Router, Switch, useLocation } from "wouter"
import type { AroundNavHandler } from "wouter"
import { AddShop } from "../features/AddShop"
import { LoginFlow } from "../features/LoginFlow"
import { markNavigated } from "../lib/nav"
import { kindOf, viewTransition } from "../lib/transition"
import { More } from "../screens/More"
import { OrderDetail } from "../screens/OrderDetail"
import { Orders } from "../screens/Orders"
import { ShipQueue } from "../screens/ShipQueue"
import { Start } from "../screens/Start"
import { Empty } from "../ui/kit"
import { TabBar } from "../ui/Nav"
import { ToastProvider } from "../ui/Toast"
import { AppProvider, useApp } from "./context"

/** Every navigation runs inside a view transition; flushSync makes React render the new page before the browser takes the "after" picture. */
const around: AroundNavHandler = (navigate, to, opts) => {
  if (opts?.replace) return navigate(to, opts) // redirects and sign-in hand-overs are not a step the person took
  void viewTransition(kindOf(location.pathname, to), () => flushSync(() => navigate(to, opts)))
}

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Router base="/medusify" aroundNav={around}>
          <Shell />
        </Router>
      </ToastProvider>
    </AppProvider>
  )
}

/** Sub pages carry their own back button and an action dock, so the tab bar steps aside there. */
const NO_TABS = /^\/(orders\/[^/]+|ship|more\/add)(\/|$)/

function Shell() {
  const { status, shops, t, retryStart, logoutNote } = useApp()
  const [location, navigate] = useLocation()
  const first = useRef(true)
  const wasReady = useRef(false)

  useEffect(() => {
    if (first.current) first.current = false
    else markNavigated()
  }, [location])
  useEffect(() => {
    if (status === "ready") wasReady.current = true
  }, [status])

  if (status === "loading") return <div className="splash" role="status" aria-busy="true" />
  if (status === "offline") {
    return (
      <div className="screen center">
        <Empty
          icon="wifi-slash"
          title={t("offline.title")}
          text={t("offline.text")}
          action={<button className="btn primary inline" onClick={retryStart}>{t("common.retry")}</button>}
        />
      </div>
    )
  }
  if (status === "login") {
    const home = shops.find((s) => s.home)
    if (!home) return <div className="splash" role="status" aria-busy="true" />
    return <LoginFlow shop={home} expired={wasReady.current && !logoutNote} onDone={() => navigate("/", { replace: true })} />
  }
  return (
    <div className="shell" data-tabs={NO_TABS.test(location) ? undefined : ""}>
      <Switch>
        <Route path="/"><Start /></Route>
        <Route path="/orders"><Orders /></Route>
        <Route path="/orders/:id">{(p) => <OrderDetail id={decodeURIComponent(p.id)} />}</Route>
        <Route path="/ship"><ShipQueue /></Route>
        <Route path="/more"><More /></Route>
        <Route path="/more/add"><AddShop onClose={() => navigate("/more")} /></Route>
        <Route><Redirect to="/" replace /></Route>
      </Switch>
      {NO_TABS.test(location) ? null : <TabBar />}
    </div>
  )
}
