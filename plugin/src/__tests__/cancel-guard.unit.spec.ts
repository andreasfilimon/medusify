import { cancelAllowed, cancelOrderChecked, type CancelDeps } from "../lib/cancel-guard"

const captured = (amount: number) => ({ id: "pay1", captured_at: "2026-11-16T11:00:00Z", captures: [{ raw_amount: amount }], refunds: [] })
const uncaptured = () => ({ id: "pay1", captured_at: null, captures: [], refunds: [] })

/** A lock that runs the job after `before` has happened, the way a request that waited for the lock does. */
function fakeLocking(before: () => void = () => {}) {
  const log: string[] = []
  return {
    execute: async <R,>(_keys: string | string[], job: () => Promise<R>): Promise<R> => {
      log.push("lock")
      before()
      try {
        return await job()
      } finally {
        log.push("unlock")
      }
    },
  }
}

function deps(over: Partial<CancelDeps> & { payments?: () => unknown[] | null; may?: boolean; log?: string[] } = {}): CancelDeps {
  const log = over.log ?? []
  return {
    locking: over.locking ?? fakeLocking(),
    paymentsOf: async () => {
      log.push("read")
      return ((over.payments ?? (() => [uncaptured()]))() as never) ?? null
    },
    mayRefund: async () => {
      log.push("may")
      return over.may ?? false
    },
  }
}

describe("cancelAllowed", () => {
  it("lets an order without captured money through, whatever the user may", async () => {
    expect(await cancelAllowed(deps({ payments: () => [uncaptured()], may: false }), "o1")).toBe("allowed")
  })
  it("needs the refund right when captured money is still unrefunded", async () => {
    expect(await cancelAllowed(deps({ payments: () => [captured(10)], may: false }), "o1")).toBe("forbidden")
    expect(await cancelAllowed(deps({ payments: () => [captured(10)], may: true }), "o1")).toBe("allowed")
  })
  it("counts fully refunded money as nothing to refund", async () => {
    const refunded = { ...captured(10), refunds: [{ raw_amount: 10 }] }
    expect(await cancelAllowed(deps({ payments: () => [refunded], may: false }), "o1")).toBe("allowed")
  })
  it("reports an order that does not exist", async () => {
    expect(await cancelAllowed(deps({ payments: () => null }), "o1")).toBe("missing")
  })
})

describe("cancelOrderChecked", () => {
  it("reads the order and checks inside the lock, and cancels last, still inside it", async () => {
    const log: string[] = []
    const d = deps({ log, payments: () => [captured(10)], may: true })
    d.locking = { execute: async (_k, job) => { log.push("lock"); try { return await job() } finally { log.push("unlock") } } }
    await cancelOrderChecked(d, "o1", async () => { log.push("cancel") })
    expect(log).toEqual(["lock", "read", "may", "cancel", "unlock"])
  })

  it("money captured while the request waited for the lock is seen: no cancel without the refund right", async () => {
    let money = false
    const cancel = jest.fn()
    const d = deps({ payments: () => (money ? [captured(10)] : [uncaptured()]), may: false })
    d.locking = fakeLocking(() => { money = true })
    await expect(cancelOrderChecked(d, "o1", cancel)).rejects.toMatchObject({ type: "forbidden" })
    expect(cancel).not.toHaveBeenCalled()
  })

  it("takes the lock of this order, so two cancels of one order run one after the other", async () => {
    const keys: (string | string[])[] = []
    const d = deps()
    d.locking = { execute: async (k, job) => { keys.push(k); return job() } }
    await cancelOrderChecked(d, "order_a", async () => {})
    await cancelOrderChecked(d, "order_b", async () => {})
    expect(keys).toEqual([["medusify-cancel:order_a"], ["medusify-cancel:order_b"]])
  })

  it("refuses an unknown order without canceling", async () => {
    const cancel = jest.fn()
    await expect(cancelOrderChecked(deps({ payments: () => null }), "o1", cancel)).rejects.toMatchObject({ type: "not_found" })
    expect(cancel).not.toHaveBeenCalled()
  })

  it("lets go of the lock when the cancel fails", async () => {
    const log: string[] = []
    const d = deps({ log })
    d.locking = { execute: async (_k, job) => { log.push("lock"); try { return await job() } finally { log.push("unlock") } } }
    await expect(cancelOrderChecked(d, "o1", async () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(log.at(-1)).toBe("unlock")
  })
})
