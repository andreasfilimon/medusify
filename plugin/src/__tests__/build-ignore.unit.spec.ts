import fs from "node:fs"
import path from "node:path"

/**
 * `medusa plugin:build` skips every file whose path has a segment equal to one of these
 * (node_modules/@medusajs/framework/dist/build-tools/compiler.js, backendIgnoreFiles). Source code
 * under such a path works in the plugin's own tests and vanishes from the published package.
 */
const BUILD_IGNORED_SEGMENTS = ["integration-tests", "test", "unit-tests"]

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe("build ignore list", () => {
  const srcRoot = path.resolve(__dirname, "..")
  const shipped = walk(srcRoot)
    .map((f) => path.relative(srcRoot, f))
    .filter((f) => !f.split(path.sep).includes("__tests__") && !f.startsWith("admin"))

  it("scans a non-trivial amount of source", () => {
    expect(shipped.length).toBeGreaterThan(20)
  })

  it("no shipped source file sits under a path segment that plugin:build drops", () => {
    const offenders = shipped.filter((f) =>
      f.split(path.sep).some((segment) => BUILD_IGNORED_SEGMENTS.includes(segment))
    )
    expect(offenders).toEqual([])
  })
})
