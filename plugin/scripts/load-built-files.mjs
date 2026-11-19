// load-built-files.mjs — require() every compiled file of the plugin (.medusa/server/src/**/*.js) under the Medusa
// version that is installed, the way Medusa loads them at start. A file that throws here stops a shop's backend.
// Exit 0 when all load, 1 when one throws or nothing was found. Run `npm run build` first.
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
process.chdir(root)
const require = createRequire(join(root, "package.json"))
const base = join(root, ".medusa/server/src")

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return files(p)
    return e.name.endsWith(".js") ? [p] : []
  })
}

const list = files(base).sort()
const installed = JSON.parse(readFileSync("node_modules/@medusajs/framework/package.json", "utf8")).version
let failed = 0
for (const file of list) {
  const name = relative(base, file)
  try {
    require(file)
    console.log(`ok   ${name}`)
  } catch (e) {
    failed++
    console.error(`FAIL ${name}: ${e?.message ?? e}`)
  }
}
if (list.length === 0) {
  console.error(`FAIL no compiled files under ${base}`)
  process.exit(1)
}
console.log(`${list.length - failed} of ${list.length} compiled files load under Medusa ${installed}`)
process.exit(failed ? 1 : 0)
