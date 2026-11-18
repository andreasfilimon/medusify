import * as http from "@medusajs/framework/http"
import { authorizeIfAvailable } from "../lib/authorize-compat"
import { ORDER_READ } from "../lib/rbac"

describe("authorizeIfAvailable", () => {
  it("uses Medusa's authorize when the framework has it (2.22.3 and later)", () => {
    const marker = jest.fn()
    const authorize = jest.fn(() => marker)
    expect(authorizeIfAvailable(ORDER_READ, { authorize })).toBe(marker)
    expect(authorize).toHaveBeenCalledWith(ORDER_READ)
  })

  it("lets the request through when the framework has no authorize (2.22.0 to 2.22.2)", () => {
    const mw = authorizeIfAvailable(ORDER_READ, {})
    const next = jest.fn()
    mw({} as any, {} as any, next)
    expect(next).toHaveBeenCalledTimes(1)
    expect(next).toHaveBeenCalledWith()
  })

  it("defaults to the installed framework", () => {
    const real = (http as Record<string, unknown>).authorize
    expect(typeof real).toBe("function")
    expect(typeof authorizeIfAvailable(ORDER_READ)).toBe("function")
  })
})
