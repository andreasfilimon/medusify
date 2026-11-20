import { describe, expect, it } from "vitest"
import { PHOTO_MAX_SIDE, fitSize } from "../src/lib/image"

describe("photo size", () => {
  it("scales the longer side down to the limit and keeps the ratio", () => {
    expect(fitSize(4032, 3024, PHOTO_MAX_SIDE)).toEqual({ width: 1600, height: 1200 })
    expect(fitSize(3024, 4032, PHOTO_MAX_SIDE)).toEqual({ width: 1200, height: 1600 })
  })
  it("never makes a small photo larger", () => {
    expect(fitSize(800, 600, PHOTO_MAX_SIDE)).toEqual({ width: 800, height: 600 })
    expect(fitSize(1600, 900, PHOTO_MAX_SIDE)).toEqual({ width: 1600, height: 900 })
  })
  it("keeps at least one pixel on a very thin photo and survives an empty one", () => {
    expect(fitSize(10000, 1, 1600)).toEqual({ width: 1600, height: 1 })
    expect(fitSize(0, 0, 1600)).toEqual({ width: 0, height: 0 })
  })
})
