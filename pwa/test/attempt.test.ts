import { beforeEach, describe, expect, it } from "vitest"
import { begin, clearAttempts, forget, gate, lost, reread } from "../src/lib/attempt"

const order = "https://a|o1"
const scope = "https://a|refund|o1|pay1"

beforeEach(clearAttempts)

describe("one key per attempt", () => {
  it("the same content on the same state keeps the key, any other content gets a new one", () => {
    const first = begin(scope, order, "500", "4498")
    lost(scope, true)
    expect(begin(scope, order, "500", "4498")).toBe(first)
    lost(scope, true)
    expect(begin(scope, order, "600", "4498")).not.toBe(first)
  })

  it("a settled attempt (done or clearly refused) starts the next one with a new key", () => {
    const first = begin(scope, order, "500", "4498")
    forget(scope)
    expect(begin(scope, order, "500", "4498")).not.toBe(first)
  })

  it("after a lost answer that could not be read back, nothing may be sent until it has been read", () => {
    begin(scope, order, "500", "4498")
    lost(scope, false)
    expect(gate(scope, order, "4498")).toBe("locked")
    reread(order)
    expect(gate(scope, order, "4498")).toBe("open")
  })

  it("once read, a changed state means the shop did it: the attempt is over", () => {
    begin(scope, order, "500", "4498")
    lost(scope, true)
    expect(gate(scope, order, "3998")).toBe("landed")
  })

  it("the lock belongs to the order, whichever sheet made the attempt: a refund and a return move the same money", () => {
    begin("https://a|return|o1", order, "i1x1|0", "i1:1|4498")
    lost("https://a|return|o1", false)
    expect(gate(scope, order, "4498")).toBe("locked")
    expect(gate("https://a|refund|o1|pay2", order, "4498")).toBe("locked")
    expect(gate("https://a|refund|o2|pay1", "https://a|o2", "4498")).toBe("open")
    reread(order)
    expect(gate(scope, order, "4498")).toBe("open")
  })
})
