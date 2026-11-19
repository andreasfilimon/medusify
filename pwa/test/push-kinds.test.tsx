import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api"
import { makeT } from "../src/lib/i18n"
import { shop } from "./fixtures"

const getPushPreferences = vi.fn()
const setPushPreference = vi.fn()
vi.mock("../src/lib/api", async (orig) => ({
  ...(await orig<typeof import("../src/lib/api")>()),
  getPushPreferences: (...a: unknown[]) => getPushPreferences(...a),
  setPushPreference: (...a: unknown[]) => setPushPreference(...a),
}))
vi.mock("../src/ui/Icon", () => ({ Icon: () => null }))
let shops = [shop("a", { home: true, name: "Alpha" })]
const toast = vi.fn()
vi.mock("../src/ui/Toast", () => ({ useToast: () => ({ show: toast }) }))
vi.mock("../src/app/context", () => ({ useApp: () => ({ t: makeT("de"), shops, currentEndpoint: async () => "https://push.example.invalid/dev1" }) }))

const { PushKinds } = await import("../src/features/PushKinds")

const renderKinds = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PushKinds />
    </QueryClientProvider>,
  )

beforeEach(() => {
  shops = [shop("a", { home: true, name: "Alpha" })]
  getPushPreferences.mockReset().mockResolvedValue({ canceled: true, return_requested: false })
  setPushPreference.mockReset()
  toast.mockReset()
})
afterEach(cleanup)

describe("push kinds in More", () => {
  it("shows the stored state per kind for this device", async () => {
    renderKinds()
    const cancel = (await screen.findByRole("switch", { name: "Stornierungen" })) as HTMLInputElement
    expect(cancel.checked).toBe(true)
    expect((screen.getByRole("switch", { name: "Retourenanfragen" }) as HTMLInputElement).checked).toBe(false)
    expect(getPushPreferences).toHaveBeenCalledWith(expect.anything(), "https://push.example.invalid/dev1")
  })
  it("a tap saves exactly that kind for that shop and device", async () => {
    setPushPreference.mockResolvedValue({ canceled: true, return_requested: true })
    renderKinds()
    fireEvent.click(await screen.findByRole("switch", { name: "Retourenanfragen" }))
    await waitFor(() => expect(setPushPreference).toHaveBeenCalledWith(expect.anything(), "https://push.example.invalid/dev1", "return_requested", true))
    await waitFor(() => expect((screen.getByRole("switch", { name: "Retourenanfragen" }) as HTMLInputElement).checked).toBe(true))
  })
  it("a failed save keeps the old state and says so", async () => {
    setPushPreference.mockRejectedValue(new ApiError("network"))
    renderKinds()
    fireEvent.click(await screen.findByRole("switch", { name: "Stornierungen" }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Einstellung nicht gespeichert.", { error: true }))
    expect((screen.getByRole("switch", { name: "Stornierungen" }) as HTMLInputElement).checked).toBe(true)
  })
  it("a shop that does not know this device (or the route) shows no rows", async () => {
    getPushPreferences.mockRejectedValue(new ApiError("notfound", 404))
    const { container } = renderKinds()
    await waitFor(() => expect(getPushPreferences).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector("input")).toBeNull()
  })
  it("with several shops each one has its own rows, named", async () => {
    shops = [shop("a", { home: true, name: "Alpha" }), shop("b", { token: "t", name: "Beta" })]
    renderKinds()
    await waitFor(() => expect(screen.getAllByRole("switch", { name: "Stornierungen" })).toHaveLength(2))
    expect(screen.getByText("Alpha")).toBeTruthy()
    expect(screen.getByText("Beta")).toBeTruthy()
  })
})
