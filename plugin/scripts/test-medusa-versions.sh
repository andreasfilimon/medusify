#!/usr/bin/env bash
# test-medusa-versions.sh [version ...] — run the plugin's checks against other Medusa versions of the peer range.
# Default: 2.22.1, the oldest one that was in the field when the plugin crashed there (it imported `authorize`, which
# exists from 2.22.3). CI runs the same steps in a matrix (.github/workflows/ci.yml, job "plugin").
#
# Per version, in a scratch copy of the plugin (this checkout stays untouched):
#   1. npm ci, then the Medusa packages of exactly that version, read back from node_modules
#   2. typecheck  3. build  4. load every compiled file  5. unit tests  6. integration tests
# Integration tests need the Postgres and Redis containers of the README ("Development").
# The scratch copy lives in $MEDUSIFY_MATRIX_DIR (default /tmp/medusify-matrix/<version>/plugin) and is overwritten by the
# next run. Exit 0 when every step of every version passed.
set -uo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
versions=("$@")
[ ${#versions[@]} -gt 0 ] || versions=(2.22.1)
overall=0

for version in "${versions[@]}"; do
  work="${MEDUSIFY_MATRIX_DIR:-/tmp/medusify-matrix}/$version"
  mkdir -p "$work/plugin"
  echo "=== Medusa $version in $work"
  # Specs read ../shared-test-data and ../pwa/src/lib/api.ts, so the copy keeps the repository layout.
  rsync -a --delete "$src/../shared-test-data/" "$work/shared-test-data/"
  mkdir -p "$work/pwa"
  rsync -a --delete "$src/../pwa/src/" "$work/pwa/src/"
  rsync -a --delete --exclude node_modules --exclude .medusa --exclude pack.json "$src/" "$work/plugin/"
  cd "$work/plugin" || exit 2
  declare -A result=()
  step() { # name command...
    local name="$1"; shift
    echo "--- $version: $name"
    "$@"; local code=$?
    result[$name]=$code
    echo "--- $version: $name exit $code"
    return 0
  }
  step install bash -c 'npm ci --no-audit --no-fund && ./scripts/install-medusa-version.sh "$0"' "$version"
  if [ "${result[install]}" = 0 ]; then
    step typecheck npm run typecheck
    step build npm run build
    step load node scripts/load-built-files.mjs
    step unit npm run test:unit
    step integration ./scripts/run-tests.sh
  fi
  echo "=== Medusa $version summary"
  for name in install typecheck build load unit integration; do
    printf '%-12s %s\n' "$name" "${result[$name]:-not run}"
    [ "${result[$name]:-1}" = 0 ] || overall=1
  done
  cd "$src" || exit 2
  unset result
done
exit $overall
