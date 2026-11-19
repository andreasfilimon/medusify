import { describe, expect, it } from "vitest"
import { isEdgeBack } from "../src/lib/edge-swipe"

describe("isEdgeBack", () => {
  it("accepts a long, flat drag that starts at the left edge", () => {
    expect(isEdgeBack({ x: 6, y: 400 }, { x: 160, y: 410 })).toBe(true)
  })
  it("rejects a drag that starts away from the edge", () => {
    expect(isEdgeBack({ x: 80, y: 400 }, { x: 240, y: 410 })).toBe(false)
  })
  it("rejects a short drag", () => {
    expect(isEdgeBack({ x: 6, y: 400 }, { x: 60, y: 402 })).toBe(false)
  })
  it("rejects a mostly vertical drag", () => {
    expect(isEdgeBack({ x: 6, y: 300 }, { x: 100, y: 600 })).toBe(false)
  })
  it("rejects a drag to the left", () => {
    expect(isEdgeBack({ x: 6, y: 400 }, { x: -100, y: 400 })).toBe(false)
  })
})
