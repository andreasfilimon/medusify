// Removes the inline source map comments that `medusa plugin:build` adds to the compiled files.
// The maps only point at ../../src/*.ts, which the package does not contain, so they add size and no information.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const root = process.argv[2] ?? ".medusa/server"
const pattern = /\n?\/\/# sourceMappingURL=data:application\/json[^\n]*\n?$/

let stripped = 0
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name.endsWith(".js")) {
      const text = readFileSync(path, "utf8")
      if (pattern.test(text)) {
        writeFileSync(path, text.replace(pattern, "\n"))
        stripped += 1
      }
    }
  }
}
walk(root)
console.log(`stripped inline source maps from ${stripped} files`)
