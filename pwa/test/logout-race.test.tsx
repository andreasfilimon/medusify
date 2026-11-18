import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api"
import { shopIdFromOrigin } from "../src/lib/shops"
import { idbStore } from "../src/lib/store"
import type { Shop } from "../src/lib/types"
import { shop } from "./fixtures"

/**
 * H8: a token refresh that finishes after the user signed out must not write the token back.
 * The real AppProvider runs here; only the network functions and the service worker are replaced.
 */
let sink: (shop: Shop, token: string) => void = () => {}
const gate: { release: () => void; promise: Promise<void> } = { release: () => {}, promise: Promise.resolve() }
const endSessionGate: { release: () => void; promise: Promise<void> } = { release: () => {}, promise: Promise.resolve() }

vi.mock("../src/lib/api", async (orig) => {
  const real = await orig<typeof import("../src/lib/api")>()
  return {
    ...real,
    setTokenSink: (fn: typeof sink) => {
      sink = fn
    },
    shopFetch: async () => new Response("{}"),
    storeName: async () => null,
    getDashboard: async () => {
      throw new real.ApiError("network")
    },
    unregisterPush: async () => {},
    endSession: async () => endSessionGate.promise,
  }
})
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))

const { AppProvider, useApp } = await import("../src/app/context")

let app: ReturnType<typeof useApp>
function Probe() {
  app = useApp()
  return <p>{app.status}</p>
}

const homeId = shopIdFromOrigin(location.origin)
const foreign = () => shop("b.example.com", { id: "https://b.example.com", url: "https://b.example.com", token: "old-token", color: 2 })

function deferred() {
  let release = () => {}
  const promise = new Promise<void>((r) => (release = r))
  return { release, promise }
}

beforeEach(async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  await idbStore.clear()
  localStorage.clear()
  Object.assign(gate, deferred())
  Object.assign(endSessionGate, deferred())
  // After the store is wiped, the browser side of sign-out (cancelling the push subscription) is slow.
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => {
            if ((await idbStore.loadShops()).length === 0) await gate.promise
            return null
          },
        },
      }),
    },
  })
  await idbStore.saveShops([{ id: homeId, url: location.origin, name: "localhost", color: 1, home: true }, foreign()])
})
afterEach(() => {
  cleanup()
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
  return view
}

describe("a token that arrives after sign-out", () => {
  it("is not saved when it arrives while the sign-out is still cancelling the push subscription", async () => {
    await ready()
    const out = app.logout()
    endSessionGate.release()
    // wait until the store is wiped, i.e. the sign-out is inside the slow last step
    await waitFor(async () => expect(await idbStore.loadShops()).toEqual([]))
    sink(foreign(), "late-token")
    await new Promise((r) => setTimeout(r, 30))
    gate.release()
    await out
    await new Promise((r) => setTimeout(r, 30))
    const saved = await idbStore.loadShops()
    expect(JSON.stringify(saved)).not.toContain("late-token")
    expect(JSON.stringify(saved)).not.toContain("old-token")
  })

  it("is not saved when it arrives after the sign-out has finished", async () => {
    await ready()
    const out = app.logout()
    endSessionGate.release()
    gate.release()
    await out
    sink(foreign(), "late-token")
    await new Promise((r) => setTimeout(r, 30))
    expect(await idbStore.loadShops()).toEqual([])
  })

  it("is saved again after the next sign-in", async () => {
    await ready()
    const out = app.logout()
    endSessionGate.release()
    gate.release()
    await out
    await app.saveShop({ id: homeId, url: location.origin, name: "localhost", color: 1, home: true })
    await app.saveShop(foreign())
    sink(foreign(), "new-token")
    await waitFor(async () => expect((await idbStore.loadShops()).find((s) => s.id === foreign().id)?.token).toBe("new-token"))
  })
})

void ApiError
