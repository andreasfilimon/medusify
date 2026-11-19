#!/usr/bin/env bash
# install-medusa-version.sh <version> — put the Medusa framework packages of exactly <version> into node_modules
# (not into package.json) and prove that it worked. CI and test-medusa-versions.sh both call it.
#
# Why: a plugin that is built and tested against one Medusa version only can break on another one inside the peer
# range. On 2.22.1 the plugin imported `authorize`, which exists from 2.22.3 on, and a shop's backend crashed at start.
# `npm ci` installs the lockfile version; this script replaces it and then reads the installed versions back, so
# a silent "installed nothing" cannot pass as a green run.
set -euo pipefail
cd "$(dirname "$0")/.."
version="${1:?usage: install-medusa-version.sh <medusa version, e.g. 2.22.1, or newest>}"
if [ "$version" = newest ]; then
  # The highest version the peer range of package.json allows, asked from the registry, so a new patch release is
  # tested without anybody editing the CI matrix.
  version="$(node -e '
    const semver = require("semver")
    const range = require("./package.json").peerDependencies["@medusajs/framework"]
    const all = JSON.parse(require("node:child_process").execFileSync("npm", ["view", `@medusajs/framework@${range}`, "version", "--json"], { encoding: "utf8" }))
    const best = semver.maxSatisfying([all].flat(), range)
    if (!best) { console.error("no version satisfies " + range); process.exit(1) }
    console.log(best)')"
  echo "newest version in the peer range: $version"
fi
[[ "$version" =~ ^2\.[0-9]+\.[0-9]+$ ]] || { echo "not a plain Medusa version: $version" >&2; exit 2; }

# Every @medusajs/* devDependency that follows the framework version (all but @medusajs/ui, which has its own).
mapfile -t packages < <(node -e '
  const dev = require("./package.json").devDependencies
  for (const name of Object.keys(dev)) {
    if (!name.startsWith("@medusajs/") || name === "@medusajs/ui") continue
    console.log(name)
  }')
# @medusajs/draft-order is a default plugin of defineConfig. Before 2.22.3 Medusa looks for it only in the project's own
# node_modules, and npm keeps it below @medusajs/medusa there (the lockfile has it that way), so name it here.
packages+=("@medusajs/draft-order")
args=()
for name in "${packages[@]}"; do args+=("$name@$version"); done

# --legacy-peer-deps: draft-order of an older version asks for an older optional @medusajs/ui peer than the one the plugin
# develops against; the optional admin UI package plays no part in what is tested here.
echo "installing: ${args[*]}"
npm install --no-save --legacy-peer-deps --no-audit --no-fund "${args[@]}"
node scripts/assert-medusa-version.mjs "$version"
