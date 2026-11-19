import { describe, expect, it } from "vitest"
import { ApiError, shipFailure } from "../src/lib/api"

// Medusa answers 409 when a refund with the same idempotency key is still in progress
// (@medusajs/payment, payment-module.js: "A refund with idempotency key … is still in progress"). The first try may
// still land, so a 409 must not count as a refusal: a refusal forgets the key, and the next try would be a second refund.
describe("a conflict answer", () => {
  it("counts as unknown, not as refused", () => {
    expect(shipFailure(new ApiError("rejected", 409, "A refund with idempotency key k is still in progress on payment p."))).toEqual({ kind: "unknown" })
  })
  it("a plain refusal stays a refusal", () => {
    expect(shipFailure(new ApiError("rejected", 400, "Amount too high"))).toEqual({ kind: "rejected", reason: "Amount too high" })
  })
})
