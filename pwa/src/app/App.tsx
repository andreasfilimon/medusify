import { useEffect, useRef } from "react"
import { Redirect, Route, Router, Switch, useLocation } from "wouter"
import { AddShop } from "../features/AddShop"
import { LoginFlow } from "../features/LoginFlow"
import { markNavigated } from "../lib/nav"
import { More } from "../screens/More"
import { OrderDetail } from "../screens/OrderDetail"
import { Orders } from "../screens/Orders"
import { ShipQueue } from "../screens/ShipQueue"
import { Start } from "../screens/Start"
import { Empty } from "../ui/kit"
import { TabBar } from "../ui/Nav"
import { ToastProvider } from "../ui/Toast"
import { AppProvider, useApp } from "./context"

export function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Router base="/medusify">
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
    <>
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
    </>
  )
}
