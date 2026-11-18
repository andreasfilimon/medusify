import { describe, expect, it } from "vitest"
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
