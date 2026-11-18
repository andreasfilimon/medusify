#!/usr/bin/env bash
# smoke-packed.sh — smoke test of the PACKED plugin inside a running shop (dev-shop).
#   BASE=http://localhost:9055 EMAIL=... PASSWORD=... ./scripts/smoke-packed.sh
#   Admin with MFA: pass a ready bearer token instead (TOKEN=...; the dev shop prints one with
#   `DEVSHOP_ADMIN_PASSWORD=... node dev-shop/scripts/devshop-token.mjs`). EMAIL and PASSWORD are then not needed.
# Exit 0 = all checks ok. Demo data only; the subscription endpoint is a fake .invalid host.
set -uo pipefail
BASE="${BASE:-http://localhost:9055}"; TOKEN="${TOKEN:-}"
if [ -z "$TOKEN" ]; then EMAIL="${EMAIL:?EMAIL or TOKEN}"; PASSWORD="${PASSWORD:?PASSWORD or TOKEN}"; fi
fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok   $1 ($3)"; else echo "FAIL $1: expected $2, got $3"; fail=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

check "GET /medusify/ (public, from the packed plugin)" 200 "$(code "$BASE/medusify/")"
check "content-type html" "text/html; charset=utf-8" "$(curl -sI "$BASE/medusify/" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2}')"
check "sw.js no-cache" "no-cache" "$(curl -sI "$BASE/medusify/sw.js" | tr -d '\r' | awk -F': ' 'tolower($1)=="cache-control"{print $2}')"
check "SPA fallback" 200 "$(code "$BASE/medusify/orders/order_x")"
check "missing asset 404" 404 "$(code "$BASE/medusify/assets/none.js")"
check "traversal blocked" 400 "$(code --path-as-is "$BASE/medusify/%2e%2e/package.json")"
check "dashboard without login" 401 "$(code "$BASE/admin/medusify/dashboard")"

[ -n "$TOKEN" ] || TOKEN="$(curl -s -X POST "$BASE/auth/user/emailpass" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))')"
[ -n "$TOKEN" ] && echo "ok   login (token obtained)" || { echo "FAIL login"; exit 1; }
AUTH=(-H "authorization: Bearer $TOKEN")

check "vapid-public-key" 200 "$(code "${AUTH[@]}" "$BASE/admin/medusify/vapid-public-key")"
check "dashboard" 200 "$(code "${AUTH[@]}" "$BASE/admin/medusify/dashboard?tz=Europe/Vienna")"
SUB='{"endpoint":"https://push.example.invalid/send/smoke","keys":{"p256dh":"BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM","auth":"tBHItJI5svbpez7KI4CCXg"}}'
check "subscribe (create)" 201 "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d "$SUB" "$BASE/admin/medusify/push-subscriptions")"
check "subscribe (idempotent)" 200 "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d "$SUB" "$BASE/admin/medusify/push-subscriptions")"
# The fake endpoint cannot be reached, so the push itself fails; the route must still answer 200 with counters.
TEST_BODY="$(curl -s -w '\n%{http_code}' -X POST "${AUTH[@]}" -H 'content-type: application/json' -d '{}' "$BASE/admin/medusify/push-subscriptions/test")"
check "test push route answers" 200 "$(printf '%s' "$TEST_BODY" | tail -n1)"
echo "     test push body: $(printf '%s' "$TEST_BODY" | head -n1)"
check "unknown action under push-subscriptions" 404 "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d '{}' "$BASE/admin/medusify/push-subscriptions/other")"
check "unsubscribe" 200 "$(code -X DELETE "${AUTH[@]}" "$BASE/admin/medusify/push-subscriptions?endpoint=https://push.example.invalid/send/smoke")"
exit $fail
