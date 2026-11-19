import { describe, expect, it } from "vitest"
import { REVEAL, swipeEnds, swipeIntent, swipeX } from "../src/lib/swipe"

describe("swipe geometry", () => {
  it("follows the finger up to the reveal width, then gives way", () => {
    expect(swipeX(0, -40)).toBe(-40)
    expect(swipeX(0, -REVEAL)).toBe(-REVEAL)
    expect(swipeX(0, -REVEAL - 40)).toBe(-REVEAL - 10)
    expect(swipeX(0, 40)).toBeCloseTo(8)
    expect(swipeX(-REVEAL, 30)).toBe(-REVEAL + 30)
  })
  it("opens past half, or on a flick", () => {
    expect(swipeEnds(-REVEAL / 2 + 1, 0)).toBe("closed")
    expect(swipeEnds(-REVEAL / 2 - 1, 0)).toBe("open")
    expect(swipeEnds(-20, -0.6)).toBe("open")
    expect(swipeEnds(-REVEAL, 0.6)).toBe("closed")
  })
  it("a scroll never becomes a swipe", () => {
    expect(swipeIntent(4, 6)).toBe("undecided")
    expect(swipeIntent(-30, 6)).toBe("swipe")
    expect(swipeIntent(-30, 25)).toBe("undecided")
    expect(swipeIntent(-14, 40)).toBe("scroll")
    expect(swipeIntent(5, 12)).toBe("scroll")
  })
})
