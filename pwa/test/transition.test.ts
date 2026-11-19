import { afterEach, describe, expect, it, vi } from "vitest"
import { kindOf, tapOrder, tappedOrder, transitionsOn, viewTransition } from "../src/lib/transition"

type VT = { finished: Promise<void> }
const stubMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }))
const stubApi = () => {
  const start = vi.fn((cb: () => Promise<void>): VT => ({ finished: Promise.resolve(cb()) }))
  Object.defineProperty(document, "startViewTransition", { value: start, configurable: true, writable: true })
  return start
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, "startViewTransition")
  delete document.documentElement.dataset.vt
})

describe("transition kind", () => {
  it("fades between tabs, slides when going deeper (base path and query ignored)", () => {
    expect(kindOf("/medusify/", "/medusify/orders")).toBe("tab")
    expect(kindOf("/medusify/orders", "/medusify/more?x=1")).toBe("tab")
    expect(kindOf("/medusify/orders", "/medusify/orders/order_1?shop=a")).toBe("forward")
    expect(kindOf("/medusify/more", "/medusify/more/add")).toBe("forward")
  })
})

describe("viewTransition", () => {
  it("runs the update inside startViewTransition and names the direction while it runs", async () => {
    stubMotion(false)
    const start = stubApi()
    let seen = ""
    await viewTransition("forward", () => { seen = document.documentElement.dataset.vt ?? "" })
    expect(start).toHaveBeenCalledOnce()
    expect(seen).toBe("forward")
    expect(document.documentElement.dataset.vt).toBeUndefined()
  })
  it("with reduced motion the page changes without a transition (fallback path)", async () => {
    stubMotion(true)
    const start = stubApi()
    const update = vi.fn()
    expect(transitionsOn()).toBe(false)
    await viewTransition("forward", update)
    expect(update).toHaveBeenCalledOnce()
    expect(start).not.toHaveBeenCalled()
  })
  it("without the API the page changes too", async () => {
    stubMotion(false)
    const update = vi.fn()
    await viewTransition("back", update)
    expect(update).toHaveBeenCalledOnce()
  })
  it("names the tapped title going forward and clears the name after", async () => {
    stubMotion(false)
    stubApi()
    const el = document.createElement("span")
    tapOrder("order_1", 7, el)
    let during = ""
    await viewTransition("forward", () => { during = el.style.viewTransitionName })
    expect(during).toBe("order-title")
    expect(el.style.viewTransitionName).toBe("")
    expect(tappedOrder("order_1")).toEqual({ n: 7 })
    expect(tappedOrder("other")).toBeNull()
  })
})
