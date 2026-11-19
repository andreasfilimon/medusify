import { readFileSync } from "node:fs"
import { join } from "node:path"

/** The installed @medusajs/framework version. The CI matrix runs the specs on several versions of the peer range. */
export function medusaVersion(): [number, number, number] {
  const file = join(process.cwd(), "node_modules/@medusajs/framework/package.json")
  const [major, minor, patch] = (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version.split(".").map(Number)
  return [major!, minor!, patch!]
}

/** Roles (the RBAC module and the `authorize` middleware) exist from Medusa 2.22.3 on. */
export function hasMedusaRbac(): boolean {
  const [major, minor, patch] = medusaVersion()
  return major > 2 || minor > 22 || (minor === 22 && patch >= 3)
}
