import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { makeT } from "../src/lib/i18n"
import { shop } from "./fixtures"

const { LogoutNotice } = await import("../src/features/LogoutNotice")

afterEach(cleanup)

describe("what the login screen says after signing out", () => {
  it("says that the session at the home shop is still open when it could not be ended", () => {
    render(<LogoutNotice t={makeT("de")} note={{ pushStillAt: [], sessionStillOpen: true }} />)
    expect(screen.getByText(/Sitzung/).textContent).toMatch(/10 Stunden/)
  })
  it("says it in English too", () => {
    render(<LogoutNotice t={makeT("en")} note={{ pushStillAt: [], sessionStillOpen: true }} />)
    expect(screen.getByText(/session/i).textContent).toMatch(/10 hours/)
  })
  it("names the shops that still hold a push subscription", () => {
    render(<LogoutNotice t={makeT("de")} note={{ pushStillAt: [shop("b", { name: "Shop B" })], sessionStillOpen: false }} />)
    expect(screen.getByText(/Shop B/)).toBeTruthy()
    expect(screen.queryByText(/Sitzung/)).toBeNull()
  })
  it("shows both when both happened", () => {
    render(<LogoutNotice t={makeT("de")} note={{ pushStillAt: [shop("b", { name: "Shop B" })], sessionStillOpen: true }} />)
    expect(screen.getByText(/Shop B/)).toBeTruthy()
    expect(screen.getByText(/10 Stunden/)).toBeTruthy()
  })
  it("shows nothing after a clean sign-out", () => {
    const { container } = render(<LogoutNotice t={makeT("de")} note={{ pushStillAt: [], sessionStillOpen: false }} />)
    expect(container.textContent).toBe("")
  })
})
