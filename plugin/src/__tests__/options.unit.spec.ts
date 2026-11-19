import { resolveOptions } from "../modules/medusify-push/options"

describe("resolveOptions: strictCancelRefund", () => {
  it("is off by default, so an existing shop's admin keeps working as before", () => {
    expect(resolveOptions(undefined).strictCancelRefund).toBe(false)
    expect(resolveOptions({}).strictCancelRefund).toBe(false)
  })
  it("is on only for true", () => {
    expect(resolveOptions({ strictCancelRefund: true }).strictCancelRefund).toBe(true)
    expect(resolveOptions({ strictCancelRefund: false }).strictCancelRefund).toBe(false)
  })
  it("anything else is reported and counts as off, and does not switch push off", () => {
    const r = resolveOptions({ strictCancelRefund: "yes" as never })
    expect(r.strictCancelRefund).toBe(false)
    expect(r.problems.join(" ")).toContain("strictCancelRefund")
    const valid = {
      vapid: { publicKey: "B".repeat(87), privateKey: "c".repeat(43), subject: "mailto:a@example.invalid" },
    }
    expect(resolveOptions({ ...valid, strictCancelRefund: "yes" as never }).enabled).toBe(true)
  })
})
