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
# 0.3.0: catalog and stock routes of the packed plugin. Reading only, plus the refusals that need no demo data.
check "products list" 200 "$(code "${AUTH[@]}" "$BASE/admin/medusify/products?limit=5")"
LOOKUP="$(curl -s "${AUTH[@]}" "$BASE/admin/medusify/variants/lookup?code=0000000000000")"
check "lookup of an unknown code answers with an empty list" '{"matches":[]}' "$(printf '%s' "$LOOKUP" | tr -d ' \n')"
check "push preferences of the smoke device: default low-stock threshold" "5" "$(curl -s "${AUTH[@]}" "$BASE/admin/medusify/push-preferences?endpoint=https://push.example.invalid/send/smoke" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("low_stock_threshold"))' 2>/dev/null || echo err)"
check "push preferences of an unknown device: 404" 404 "$(code "${AUTH[@]}" "$BASE/admin/medusify/push-preferences?endpoint=https://push.example.invalid/none")"
check "stock change without a key is refused" 400 "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d '{"mode":"adjust","inventory_item_id":"iitem_none","location_id":"sloc_none","quantity":1}' "$BASE/admin/medusify/inventory")"
check "price of an unknown variant is 404" 404 "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d '{"currency_code":"eur","amount":1}' "$BASE/admin/medusify/variants/variant_none/price")"
# 0.4.0: customers, orders by hand, order changes. Reading only, plus refusals that make nothing.
check "customers list" 200 "$(code "${AUTH[@]}" "$BASE/admin/medusify/customers?limit=5")"
check "unknown customer is 404" 404 "$(code "${AUTH[@]}" "$BASE/admin/medusify/customers/cus_none")"
check "form setup for an order by hand" 200 "$(code "${AUTH[@]}" "$BASE/admin/medusify/orders/setup")"
check "asking for an unknown key of an order by hand" '{"state":"none"}' "$(curl -s "${AUTH[@]}" "$BASE/admin/medusify/orders/attempts/smoke-none-0000" | tr -d ' \n')"
check "asking with a key too short is refused" 400 "$(code "${AUTH[@]}" "$BASE/admin/medusify/orders/attempts/short")"
check "order by hand without items is refused" 400 "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d '{"region_id":"reg_none","email":"smoke@example.invalid","items":[],"idempotency_key":"smoke-0000-0000"}' "$BASE/admin/medusify/orders")"
check "change preview with a bad body is refused" 400 "$(code -X POST "${AUTH[@]}" -H 'content-type: application/json' -d '{"change":{"kind":"other"}}' "$BASE/admin/medusify/orders/order_none/change/preview")"
check "rights list has the new rights" "True" "$(curl -s "${AUTH[@]}" "$BASE/admin/medusify/permissions" | python3 -c 'import sys,json; a=json.load(sys.stdin).get("actions",{}); print(all(k in a for k in ["customers","discounts","manual_order","order_edit","exchange","claim"]))' 2>/dev/null || echo err)"
check "unsubscribe" 200 "$(code -X DELETE "${AUTH[@]}" "$BASE/admin/medusify/push-subscriptions?endpoint=https://push.example.invalid/send/smoke")"
exit $fail
