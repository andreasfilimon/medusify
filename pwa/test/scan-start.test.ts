import { afterEach, expect, it, vi } from "vitest"

vi.mock("zxing-wasm/reader", () => {
  throw new Error("chunk failed to load")
})
vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({ default: "/x.wasm" }))

afterEach(() => vi.unstubAllGlobals())

it("closes the camera when the decoder does not load, instead of leaving it on without reading", async () => {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  vi.stubGlobal("navigator", { ...navigator, mediaDevices: { getUserMedia: vi.fn(async () => stream) } })
  const { startScan } = await import("../src/lib/scan")
  const video = document.createElement("video")
  video.play = vi.fn(async () => undefined)
  const res = await startScan(video, () => {})
  expect(res.kind).toBe("no-camera")
  expect(stop).toHaveBeenCalled()
  expect(video.srcObject).toBeNull()
})
