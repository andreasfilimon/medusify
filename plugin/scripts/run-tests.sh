#!/usr/bin/env bash
# run-tests.sh [jest args...] — runs the integration tests against the local test containers
# (Postgres 127.0.0.1:55432, Redis 127.0.0.1:56379, see README "Development").
# Own process group + hard timeout (killpg via `timeout`).
set -uo pipefail
cd "$(dirname "$0")/.."
export DB_HOST="${DB_HOST:-localhost}" DB_PORT="${DB_PORT:-55432}" DB_USERNAME="${DB_USERNAME:-postgres}" DB_PASSWORD="${DB_PASSWORD:-medusify_test}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:56379}"
export TEST_TYPE=integration:http NODE_OPTIONS=--experimental-vm-modules NODE_ENV=test
exec setsid --wait timeout -k 15 "${TEST_TIMEOUT:-900}" npx jest --silent=false --runInBand --forceExit "$@"
