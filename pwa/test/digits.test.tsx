import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
import { Digits } from "../src/ui/kit"

const rolling = (c: HTMLElement) => [...c.querySelectorAll(".roll")].map((e) => e.textContent)

describe("Digits", () => {
  it("shows the plain text and rolls nothing on the first render", () => {
    const { container } = render(<Digits text="€ 1.234,50" />)
    expect(container.textContent).toBe("€ 1.234,50")
    expect(rolling(container)).toEqual([])
  })
  it("rolls only the digits that changed, matched by place from the end", () => {
    const { container, rerender } = render(<Digits text="€ 1.234,50" />)
    rerender(<Digits text="€ 1.234,75" />)
    expect(container.textContent).toBe("€ 1.234,75")
    expect(rolling(container)).toEqual(["7", "5"])
  })
  it("a longer number rolls the new place and leaves the unchanged places still", () => {
    const { container, rerender } = render(<Digits text="99" />)
    rerender(<Digits text="100" />)
    expect(rolling(container)).toEqual(["1", "0", "0"])
    rerender(<Digits text="100" />)
    expect(rolling(container)).toEqual([])
  })
})
