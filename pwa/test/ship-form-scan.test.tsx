import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { makeT } from "../src/lib/i18n"
import { order, shop } from "./fixtures"

let onCode: (v: string) => void = () => {}
vi.mock("../src/lib/scan", () => ({
  startScan: async (_v: HTMLVideoElement, cb: (v: string) => void) => {
    onCode = cb
    return { kind: "started", handle: { stop() {} } }
  },
}))
vi.mock("../src/lib/api", async (orig) => ({
  ...(await orig<typeof import("../src/lib/api")>()),
  shipPlan: async () => ({ locations: [{ id: "sloc_1", name: "Wien" }], packsNew: true, packages: [] }),
  getPermissions: async () => ({ ship: true }),
}))
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), online: true }) }))

const { ShipForm } = await import("../src/ui/ShipForm")
afterEach(cleanup)

it("the camera fills the field until the user types, and again once the field is emptied", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ShipForm shop={shop("a", { home: true })} order={order("o1")} onDone={() => {}} />
    </QueryClientProvider>,
  )
  const field = (await screen.findByLabelText("Sendungsnummer (optional)")) as HTMLInputElement
  await waitFor(() => expect(onCode).not.toBe(undefined))
  act(() => onCode("900000000017"))
  expect(field.value).toBe("900000000017")
  fireEvent.change(field, { target: { value: "312116201166" } })
  act(() => onCode("900000000017"))
  expect(field.value).toBe("312116201166")
  fireEvent.change(field, { target: { value: "" } })
  act(() => onCode("900000000017"))
  expect(field.value).toBe("900000000017")
})
