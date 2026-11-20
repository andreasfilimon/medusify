import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "../src/lib/api"
import { makeT } from "../src/lib/i18n"
import { shop } from "./fixtures"

const getPushPreferences = vi.fn()
const setPushPreference = vi.fn()
const setLowStockThreshold = vi.fn()
vi.mock("../src/lib/api", async (orig) => ({
  ...(await orig<typeof import("../src/lib/api")>()),
  getPushPreferences: (...a: unknown[]) => getPushPreferences(...a),
  setPushPreference: (...a: unknown[]) => setPushPreference(...a),
  setLowStockThreshold: (...a: unknown[]) => setLowStockThreshold(...a),
}))
const prefs = (kinds: Record<string, boolean>, low_stock_threshold = 5) => ({ kinds: { canceled: true, return_requested: false, low_stock: true, ...kinds }, low_stock_threshold })
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
  getPushPreferences.mockReset().mockResolvedValue(prefs({}))
  setPushPreference.mockReset()
  setLowStockThreshold.mockReset()
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
    setPushPreference.mockResolvedValue(prefs({ return_requested: true }))
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

  it("shows the low-stock row with the device's threshold, on by default", async () => {
    getPushPreferences.mockResolvedValue(prefs({}, 7))
    renderKinds()
    expect((await screen.findByRole("switch", { name: "Bestand niedrig" }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole("group", { name: "Meldung ab Bestand" }).textContent).toContain("7")
  })
  it("five taps on the stepper are one save with the final number", async () => {
    setLowStockThreshold.mockResolvedValue(prefs({}, 10))
    renderKinds()
    const plus = await screen.findByRole("button", { name: "Eins mehr" })
    for (let i = 0; i < 5; i++) fireEvent.click(plus)
    await waitFor(() => expect(setLowStockThreshold).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(setLowStockThreshold).toHaveBeenCalledWith(expect.anything(), "https://push.example.invalid/dev1", 10)
  })
  it("the threshold stops at 0 and at 9999", async () => {
    getPushPreferences.mockResolvedValue(prefs({}, 0))
    const { unmount } = renderKinds()
    expect(((await screen.findByRole("button", { name: "Eins weniger" })) as HTMLButtonElement).disabled).toBe(true)
    unmount()
    getPushPreferences.mockResolvedValue(prefs({}, 9999))
    renderKinds()
    expect(((await screen.findByRole("button", { name: "Eins mehr" })) as HTMLButtonElement).disabled).toBe(true)
  })
  it("a failed threshold save says so and reads the shop's number again", async () => {
    setLowStockThreshold.mockRejectedValue(new ApiError("network"))
    renderKinds()
    fireEvent.click(await screen.findByRole("button", { name: "Eins mehr" }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Einstellung nicht gespeichert.", { error: true }), { timeout: 3000 })
    await waitFor(() => expect(getPushPreferences.mock.calls.length).toBeGreaterThan(1))
  })
  it("a plugin older than 0.3.0 (no threshold in the answer) shows no low-stock row", async () => {
    getPushPreferences.mockResolvedValue({ kinds: { canceled: true, return_requested: false }, low_stock_threshold: -1 })
    renderKinds()
    await screen.findByRole("switch", { name: "Stornierungen" })
    expect(screen.queryByRole("switch", { name: "Bestand niedrig" })).toBeNull()
    expect(screen.queryByRole("group", { name: "Meldung ab Bestand" })).toBeNull()
  })
  it("with the kind off the threshold row is gone", async () => {
    getPushPreferences.mockResolvedValue(prefs({ low_stock: false }))
    renderKinds()
    expect((await screen.findByRole("switch", { name: "Bestand niedrig" }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole("group", { name: "Meldung ab Bestand" })).toBeNull()
  })
})
