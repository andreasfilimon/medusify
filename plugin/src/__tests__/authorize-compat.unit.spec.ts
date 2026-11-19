import { readFileSync } from "node:fs"
import { join } from "node:path"
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
    // Medusa has `authorize` from 2.22.3 on; the CI matrix and scripts/test-medusa-versions.sh run this on 2.22.1 as well.
    // Read from disk: the package does not export its package.json on every version.
    const installed = (JSON.parse(readFileSync(join(process.cwd(), "node_modules/@medusajs/framework/package.json"), "utf8")) as { version: string }).version
    const [major, minor, patch] = installed.split(".").map(Number)
    const hasAuthorize = major! > 2 || minor! > 22 || (minor === 22 && patch! >= 3)
    const real = (http as Record<string, unknown>).authorize
    expect(typeof real).toBe(hasAuthorize ? "function" : "undefined")
    expect(typeof authorizeIfAvailable(ORDER_READ)).toBe("function")
  })
})
