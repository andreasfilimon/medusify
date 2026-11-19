import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { makeT } from "../src/lib/i18n"
import { nearestStop, rubber } from "../src/lib/sheet-drag"

vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), lang: "de" }) }))
const { Sheet } = await import("../src/ui/Sheet")

describe("where a sheet lands", () => {
  const stops = { large: 0, medium: 300, closed: 600 }
  it("takes the nearest rest point, a flick goes further than the drag", () => {
    expect(nearestStop(20, 0, stops)).toBe("large")
    expect(nearestStop(250, 0, stops)).toBe("medium")
    expect(nearestStop(400, 0, stops)).toBe("medium")
    expect(nearestStop(460, 0, stops)).toBe("closed")
    expect(nearestStop(250, 1.5, stops)).toBe("closed")
    expect(nearestStop(250, -1.5, stops)).toBe("large")
  })
  it("never lands on closed when there is no closed stop (a locked sheet)", () => {
    expect(nearestStop(900, 3, { large: 0, medium: null, closed: null })).toBe("large")
    expect(nearestStop(900, 3, { large: 0, medium: 300, closed: null })).toBe("medium")
  })
  it("gives way past the top only by a fraction", () => {
    expect(rubber(-100, 0, Number.POSITIVE_INFINITY)).toBe(-15)
    expect(rubber(120, 0, Number.POSITIVE_INFINITY)).toBe(120)
  })
})

describe("dragging a sheet away", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 400, width: 390, top: 400, left: 0, right: 390, bottom: 800, x: 0, y: 400, toJSON() {} })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  const pull = (container: HTMLElement) => {
    const grab = container.ownerDocument.querySelector(".grab")!
    fireEvent.pointerDown(grab, { pointerId: 1, clientY: 100, pointerType: "touch" })
    fireEvent.pointerMove(grab, { pointerId: 1, clientY: 300, pointerType: "touch" })
    fireEvent.pointerMove(grab, { pointerId: 1, clientY: 600, pointerType: "touch" })
    fireEvent.pointerUp(grab, { pointerId: 1, clientY: 600, pointerType: "touch" })
    act(() => void vi.advanceTimersByTime(900))
  }
  it("a free sheet goes away when pulled down", () => {
    const onClose = vi.fn()
    const { container } = render(<Sheet title="Test" onClose={onClose}>x</Sheet>)
    pull(container)
    expect(onClose).toHaveBeenCalledOnce()
  })
  it("a locked sheet (money is on its way) stays, however hard it is pulled", () => {
    const onClose = vi.fn()
    const { container } = render(<Sheet title="Test" onClose={onClose} locked>x</Sheet>)
    pull(container)
    expect(onClose).not.toHaveBeenCalled()
  })
})
