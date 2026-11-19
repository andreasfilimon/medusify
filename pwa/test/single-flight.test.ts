import { describe, expect, it, vi } from "vitest"
import { singleFlight } from "../src/lib/single-flight"

describe("single flight", () => {
  it("sends one request for a double tap", async () => {
    let release!: () => void
    const send = vi.fn(() => new Promise<string>((r) => (release = () => r("done"))))
    const run = singleFlight(send)
    const first = run()
    const second = run()
    expect(await second).toBeUndefined()
    release()
    expect(await first).toBe("done")
    expect(send).toHaveBeenCalledTimes(1)
  })
  it("lets the next call through once the first is done", async () => {
    const send = vi.fn(async () => 1)
    const run = singleFlight(send)
    await run()
    await run()
    expect(send).toHaveBeenCalledTimes(2)
  })
  it("lets the next call through after a failure", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok")
    const run = singleFlight(send)
    await expect(run()).rejects.toThrow("boom")
    expect(await run()).toBe("ok")
  })
})
