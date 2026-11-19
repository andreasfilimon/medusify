// assert-medusa-version.mjs <version> — every installed @medusajs/* framework package must be exactly <version>.
// Exit 0 when so, 1 when one differs (or none is found), 2 on bad usage. Prints what it read.
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

process.chdir(fileURLToPath(new URL("..", import.meta.url)))

const want = process.argv[2]
if (!want) {
  console.error("usage: node assert-medusa-version.mjs <version>")
  process.exit(2)
}

// @medusajs/ui has its own version line (4.x) and brings its own @medusajs/icons; neither belongs to the framework.
const OWN_VERSION = new Set(["@medusajs/ui"])
const found = []

function walk(dir, inUi) {
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const path = join(dir, name)
    if (name === ".bin" || name === ".package-lock.json") continue
    if (name.startsWith("@")) {
      walk(path, inUi)
      continue
    }
    let pkg
    try {
      pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"))
    } catch {
      continue
    }
    if (pkg.name?.startsWith("@medusajs/") && !OWN_VERSION.has(pkg.name) && !inUi) {
      found.push({ name: pkg.name, version: pkg.version, path })
    }
    const nested = join(path, "node_modules")
    try {
      if (statSync(nested).isDirectory()) walk(nested, inUi || pkg.name === "@medusajs/ui")
    } catch {
      /* no nested modules */
    }
  }
}
walk("node_modules", false)

const wrong = found.filter((p) => p.version !== want)
const names = new Set(found.map((p) => p.name))
for (const must of ["@medusajs/framework", "@medusajs/medusa", "@medusajs/cli", "@medusajs/core-flows"]) {
  if (!names.has(must)) {
    console.error(`FAIL ${must} is not installed`)
    process.exit(1)
  }
}
console.log(`${found.length} @medusajs framework packages found, ${found.length - wrong.length} at ${want}`)
if (wrong.length > 0) {
  for (const p of wrong) console.error(`FAIL ${p.name} is ${p.version} (${p.path}), expected ${want}`)
  process.exit(1)
}
const fw = JSON.parse(readFileSync("node_modules/@medusajs/framework/package.json", "utf8")).version
console.log(`ok   @medusajs/framework ${fw}`)
