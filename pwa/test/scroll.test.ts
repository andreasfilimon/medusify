import { describe, expect, it, vi } from "vitest"

vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
import { PULL_MAX, PULL_TRIGGER, pullDistance, shouldRefresh } from "../src/ui/Scroll"

describe("pull to refresh", () => {
  it("dampens and caps the pull", () => {
    expect(pullDistance(-20)).toBe(0)
    expect(pullDistance(100)).toBe(50)
    expect(pullDistance(1000)).toBe(PULL_MAX)
  })
  it("triggers only past the threshold", () => {
    expect(shouldRefresh(PULL_TRIGGER - 1)).toBe(false)
    expect(shouldRefresh(PULL_TRIGGER)).toBe(true)
  })
})

import { afterEach } from "vitest"
import { COLLAPSE_AT, TITLE_AT, collapseState, initScrollMode, nativeScrollAnimations, resetScrollModeForTest } from "../src/lib/scroll-mode"

describe("scroll mode: native path and fallback", () => {
  const stub = (supports: boolean, reduce: boolean) => {
    vi.stubGlobal("CSS", { supports: () => supports })
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }))
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    resetScrollModeForTest()
  })
  it("switches to the bar and title states at their thresholds", () => {
    expect(collapseState(COLLAPSE_AT)).toEqual({ collapsed: false, title: false })
    expect(collapseState(COLLAPSE_AT + 1)).toEqual({ collapsed: true, title: false })
    expect(collapseState(TITLE_AT + 1)).toEqual({ collapsed: true, title: true })
  })
  it("uses native scroll-driven animations only where supported and motion is welcome", () => {
    stub(true, false)
    expect(nativeScrollAnimations()).toBe(true)
    initScrollMode()
    expect(document.documentElement.hasAttribute("data-sda")).toBe(true)
  })
  it("the fallback path (no support) sets no data-sda", () => {
    stub(false, false)
    expect(nativeScrollAnimations()).toBe(false)
    initScrollMode()
    expect(document.documentElement.hasAttribute("data-sda")).toBe(false)
  })
  it("reduced motion turns the native path off even where it is supported", () => {
    stub(true, true)
    expect(nativeScrollAnimations()).toBe(false)
    initScrollMode()
    expect(document.documentElement.hasAttribute("data-sda")).toBe(false)
  })
})
