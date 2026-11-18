import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { enablePush } from "../src/lib/push"
import { logoutAll } from "../src/lib/session"
import { shopIdFromOrigin } from "../src/lib/shops"
import { idbStore } from "../src/lib/store"
import { SwTimeoutError, swConfig, swReady } from "../src/lib/sw"
import { shop } from "./fixtures"

/**
 * H9: `navigator.serviceWorker.ready` can stay pending forever. The wait ends with an error, sign-out still
 * finishes, and turning notifications on says what is wrong. The real AppProvider runs in the last block.
 */
vi.mock("../src/lib/api", async (orig) => {
  const real = await orig<typeof import("../src/lib/api")>()
  return {
    ...real,
    shopFetch: async () => new Response("{}"),
    storeName: async () => null,
    getDashboard: async () => {
      throw new real.ApiError("network")
    },
    getVapidKey: async () => "AAAA",
    unregisterPush: async () => {},
    endSession: async () => {},
  }
})
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
const { AppProvider, useApp } = await import("../src/app/context")
const { More } = await import("../src/screens/More")
const { ToastProvider } = await import("../src/ui/Toast")

describe("swReady", () => {
  it("rejects with SwTimeoutError when the worker never becomes ready", async () => {
    await expect(swReady(new Promise(() => {}), 20)).rejects.toBeInstanceOf(SwTimeoutError)
  })
  it("passes the registration through when it is ready in time", async () => {
    await expect(swReady(Promise.resolve("reg"), 20)).resolves.toBe("reg")
  })
})

describe("enablePush without a ready service worker", () => {
  it("reports sw-timeout so the screen can say what to do", async () => {
    const out = await enablePush([shop("a.example.com", { home: true })], {
      api: { getVapidKey: async () => "AAAA", registerPush: async () => {}, unregisterPush: async () => {} },
      requestPermission: async () => "granted",
      registration: async () => {
        throw new SwTimeoutError()
      },
    })
    expect(out).toEqual({ kind: "failed", error: "sw-timeout" })
  })
})

describe("logoutAll when the push subscription cannot be read", () => {
  it("still wipes the device and lists every shop that holds a subscription", async () => {
    const a = shop("a.example.com", { home: true, pushRegistered: true })
    const b = shop("b.example.com", { pushRegistered: true, token: "t" })
    const c = shop("c.example.com", { token: "t" })
    const store = { loadShops: async () => [], saveShops: async () => {}, clear: vi.fn(async () => {}) }
    const unsubscribeLocal = vi.fn(async () => {})
    const res = await logoutAll([a, b, c], {
      push: { getVapidKey: async () => "", registerPush: async () => {}, unregisterPush: vi.fn(async () => {}) },
      endSession: async () => {},
      store,
      currentEndpoint: async () => {
        throw new SwTimeoutError()
      },
      unsubscribeLocal,
      clearSessionPrefs: () => {},
    })
    expect(store.clear).toHaveBeenCalled()
    // the unreachable service worker is not waited for a second time
    expect(unsubscribeLocal).not.toHaveBeenCalled()
    expect(res.pushStillAt.map((s) => s.id)).toEqual([a.id, b.id])
  })
})

describe("the app without a service worker that becomes ready", () => {
  let app: ReturnType<typeof useApp>
  function Probe() {
    app = useApp()
    return <p>{app.status}</p>
  }
  const homeId = shopIdFromOrigin(location.origin)
  const before = swConfig.readyTimeoutMs

  beforeEach(async () => {
    swConfig.readyTimeoutMs = 200
    vi.stubGlobal("PushManager", function () {})
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal("Notification", Object.assign(function () {}, { permission: "granted", requestPermission: async () => "granted" }))
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: new Promise(() => {}) } })
    await idbStore.clear()
    localStorage.clear()
    await idbStore.saveShops([
      { id: homeId, url: location.origin, name: "localhost", color: 1, home: true, pushRegistered: true },
      { id: "https://b.example.com", url: "https://b.example.com", name: "b", color: 2, home: false, token: "t", pushRegistered: true },
    ])
  })
  afterEach(() => {
    cleanup()
    swConfig.readyTimeoutMs = before
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, "serviceWorker")
  })

  async function ready() {
    const view = render(
      <AppProvider>
        <Probe />
      </AppProvider>,
    )
    await waitFor(() => expect(view.getByText("ready")).toBeTruthy())
  }

  it("signs out anyway and names the shops that may still hold a subscription, after one wait and not two", async () => {
    await ready()
    const started = Date.now()
    const res = await app.logout()
    expect(Date.now() - started).toBeLessThan(380)
    expect(res.pushStillAt.map((s) => s.id).sort()).toEqual([homeId, "https://b.example.com"].sort())
    expect(await idbStore.loadShops()).toEqual([])
  })

  it("answers turning on notifications with sw-timeout instead of waiting", async () => {
    await ready()
    const out = await app.enableNotifications()
    expect(out).toEqual({ kind: "failed", error: "sw-timeout" })
  })

  it("shows the user what to do when turning on notifications runs into the missing service worker", async () => {
    render(
      <AppProvider>
        <ToastProvider>
          <More />
        </ToastProvider>
      </AppProvider>,
    )
    // The list of shops is filled when the app has started; a tap before that would answer "no shop".
    await screen.findByText(new RegExp(location.host))
    fireEvent.click(await screen.findByRole("button", { name: "Turn on notifications" }))
    const note = await screen.findByText(/has not finished loading/, undefined, { timeout: 2000 })
    expect(note.textContent).toMatch(/reopen the app/)
    expect(screen.queryByText(/Not subscribed/)).toBeNull()
  })
})
