# medusify

A [Medusa v2](https://docs.medusajs.com) plugin that adds web push, a dashboard API and a phone-friendly admin app to your shop:

- **Web Push** to every admin device that subscribed — "New order #42, €44.98 · 2 items" (iOS, Android, desktop). Cancellations and return requests are pushed too and can be switched off per device and shop.
- **Order actions for the app**: accept a return (request, receipt and refund in one step) and the rights the app needs to show only what the signed-in user may do.
- **Dashboard API** for the Medusify app: revenue today / this month **per currency**, orders to ship, last 10 orders.
- **Hosts the Medusify PWA** under `/medusify` of your Medusa backend (static files, service-worker ready).

Works with Medusa **2.22.x** (peer range `>=2.22.0 <2.23.0`), Node **>= 22.22**. No central server, no third-party
account: push goes browser → your shop → the browser vendor's push service. Admins sign in with their normal Medusa
admin account (including Medusa's built-in MFA).
If your shop offers Google sign-in for admins (`http.authMethodsPerActor`), the app offers it too. Session model and
limits: [`docs/SECURITY.md`](https://github.com/andreasfilimon/medusify/blob/main/docs/SECURITY.md); app source and tests:
[`pwa/README.md`](https://github.com/andreasfilimon/medusify/blob/main/pwa/README.md).

## Install

```bash
npm install medusify      # or pnpm / yarn
```

### 1. Generate a VAPID key pair (once per merchant, not per shop)

```bash
npx web-push generate-vapid-keys
```

Keep the **private** key secret (environment variable, never in git). The public key is served to your admins by the API.

### 2. Register the plugin in `medusa-config.ts`

```ts
import { defineConfig } from "@medusajs/framework/utils"

module.exports = defineConfig({
  // ...
  plugins: [
    {
      resolve: "medusify",
      options: {
        vapid: {
          publicKey: process.env.MEDUSIFY_VAPID_PUBLIC_KEY,
          privateKey: process.env.MEDUSIFY_VAPID_PRIVATE_KEY,
          subject: process.env.MEDUSIFY_VAPID_SUBJECT, // "mailto:you@example.com" or an https:// URL
        },
        storeLabel: "My Shop", // shown in the push title: "My Shop: New order #42"
        locale: "en",          // "de" (default) or "en" — language of push texts
        // pwaDir: "/abs/path/to/pwa-bundle", // optional: serve your own bundle instead of the shipped one
        // strictCancelRefund: true,          // optional: see "Order actions and rights"
      },
    },
  ],
})
```

| Option | Required | Default | Meaning |
| --- | --- | --- | --- |
| `vapid.publicKey` | yes | – | VAPID public key (87 url-safe base64 chars) |
| `vapid.privateKey` | yes | – | VAPID private key (43 chars). Secret. |
| `vapid.subject` | yes | – | Contact for the push services: `mailto:` address or `https://` URL |
| `storeLabel` | no | `"Shop"` | Prefix of the push title |
| `locale` | no | `"de"` | `"de"` or `"en"`; amounts use `Intl.NumberFormat` in this locale |
| `pwaDir` | no | `<plugin>/pwa-dist` | Absolute path of the PWA bundle served at `/medusify` |
| `strictCancelRefund` | no | `false` | `true`: Medusa's own cancel route also asks for the refund right when captured money would go back (see "Order actions and rights") |

**Bad or missing VAPID options never stop your shop.** The backend logs one warning at startup
(`[medusify] push is OFF: ...`), push is switched off, and the dashboard and the PWA keep working. The routes that need
push answer `400 ... not configured`.

### 3. Run the migration

```bash
npx medusa db:migrate
```

This creates one table, `medusify_push_subscription` (prefixed so it can't collide with other plugins).

### 4. Open the app

`https://<your-backend>/medusify/` — add it to the iPhone home screen (iOS only delivers push to an installed web app).

## What the plugin adds

All admin routes use Medusa's standard admin authentication (session or bearer token of an admin user, so a completed
MFA login is required whenever you enforce it). Without login every one of them answers `401`.

| Route | Purpose |
| --- | --- |
| `GET /admin/medusify/vapid-public-key` | Public key for `pushManager.subscribe()` → `{ public_key }` |
| `POST /admin/medusify/push-subscriptions` | Register a device: `{ endpoint, keys: { p256dh, auth }, user_agent? }`. Idempotent per `endpoint` (201 first time, 200 afterwards). |
| `DELETE /admin/medusify/push-subscriptions` | Remove the caller's subscription: body `{ endpoint }` or `?endpoint=`. Only your own. |
| `POST /admin/medusify/push-subscriptions/test` | Send a test push to the caller's own devices → `{ sent, failed, removed }` |
| `GET /admin/medusify/dashboard?tz=Europe/Vienna` | `shop_label` (the name push titles carry), revenue (per currency) and order counts for today and this month in the given time zone, `to_ship`, `recent_orders` (10) |
| `GET /admin/medusify/push-preferences?endpoint=` | Which optional push kinds this device gets, and from how many units the low-stock message comes → `{ kinds: { canceled, return_requested, low_stock }, low_stock_threshold }`. Only your own device, otherwise `404`. |
| `POST /admin/medusify/push-preferences` | Switch one optional kind for this device: `{ endpoint, kind: "canceled" \| "return_requested" \| "low_stock", enabled }`, or set the threshold: `{ endpoint, low_stock_threshold }` (whole number 0 to 9999) → `{ kinds, low_stock_threshold }`. Only your own device. |
| `GET /admin/medusify/permissions` | What the signed-in user may do in the app → `{ actions: { capture, mark_paid, cancel, cancel_refunding, deliver, refund, return, ship, catalog, variant_edit, product_status, stock, stock_new_level, product_create, upload, stock_read } }` (booleans) |
| `GET /admin/medusify/products?q=&offset=&limit=` | The catalog for the phone: products with variants, plain and rule prices, and stock per location (stocked, reserved, available, incoming) → `{ products, count, offset, limit }`. `q` searches title, SKU and barcode. |
| `GET /admin/medusify/products/:id` | One product in the same shape → `{ product }`; `404 medusify:no_product` |
| `GET /admin/medusify/variants/lookup?code=` | The variants a scanned code belongs to, matched in the order barcode, SKU, EAN, UPC (a UPC-A also matches its EAN-13 twin with a leading 0) → `{ matches: [{ product, variant, matched_by }] }`. Longer than 128 characters is a `400`. |
| `POST /admin/medusify/variants/:id/price` | Set the plain price of one currency: `{ currency_code, amount }` (amount in the main unit, at most the currency's decimals) → `{ prices }`. The variant's other prices, region prices and tiers stay (see "Catalog and stock"). |
| `POST /admin/medusify/inventory` | One stock change, always with an `idempotency_key` (8+ characters): `{ mode: "adjust", inventory_item_id, location_id, quantity }` (a difference), `{ mode: "set", … }` (a count) or `{ mode: "undo", undo_of: <key> }` → `{ stocked, reserved, available, delta, replayed }`. A repeat of a key changes nothing and answers `replayed: true`. |
| `POST /admin/medusify/products` | Quick create: one product with one variant, a price, an optional photo address and the stock at one location, in one workflow: `{ title, status: "draft" \| "published", price: { currency_code, amount }, stock: { location_id, quantity }, image_url?, idempotency_key }` → `201 { product_id, variant_id, replayed }`; a repeat of the key is `200` with the same product. |
| `POST /admin/medusify/returns` | Accept a return: `{ order_id, items: [{ id, quantity }], refund_amount?, note?, idempotency_key? }` → `201 { return_id, order_id, refunded }`. The same `idempotency_key` for the same order and content answers with the first return (`200`, no second return, no second refund); the same key with other content is a `409`. |
| `POST /admin/medusify/orders/:id/cancel` | Cancel an order like Medusa's own route, plus one check: if captured money would be refunded by it, the caller needs the refund right as well. The app uses this route. |
| `GET /medusify/*` | The PWA (public static files, no auth) |

### Roles (Medusa RBAC)

Medusa 2.22.3 and newer can restrict admin users by role: the RBAC module (`@medusajs/medusa/rbac`, needs a Medusa license
key) and the `authorize` middleware that guards Medusa's own admin routes. Without that module, and on 2.22.0 to 2.22.2
where it does not exist yet, nothing below applies and every admin may use everything, as before. With it, Medusify asks for the same right Medusa asks for on `/admin/orders`, `order:read`:

- `GET /admin/medusify/dashboard` and `POST /admin/medusify/push-subscriptions` answer `403` for an admin whose roles
  do not grant `order:read` (or a wildcard such as `*:*`). The user gets no revenue figures and no push subscription.
- A new order is pushed only to subscriptions of users who have that right **at the time of the order**. A subscription
  made earlier by a user who lost the right is kept (the right may come back) but gets nothing. If the permission
  check itself fails, nothing is sent to that user.
- `DELETE /admin/medusify/push-subscriptions` stays open for every logged-in admin, so a device can always be removed.
  `GET /admin/medusify/vapid-public-key` (a public key) and the test push (sent to the caller's own devices only) are
  not restricted.

Subscriber `order.placed` pushes "`<storeLabel>`: New order #`<display_id>`" / "`<total>` · `<n>` items"
(`data.url = /medusify/orders/<id>`) to every subscription of the shop. It is **fail-open**: any push error is caught and
logged; it can never disturb an order. A subscription that the push service reports as gone (HTTP 404/410) is deleted;
after 20 consecutive other failures it is deleted too.

### Order actions and rights

The app does capture, mark as paid, mark as delivered and refund with **Medusa's own admin routes**, so Medusa checks the
right on each of them. The plugin adds two routes of its own, `POST /admin/medusify/returns` and
`POST /admin/medusify/orders/:id/cancel`, and the rights route the app uses to hide what the user may not do. Canceling
needs its own route because Medusa's cancel refunds every captured payment but asks only for the order right. With the RBAC module active (see above) the routes ask for:

| Action | Rights (all of them) |
| --- | --- |
| Capture a payment | `capture:create`, `order:update` |
| Mark as paid | `payment_collection:update`, `order:update` |
| Cancel an order | `order:update`; if captured money would be refunded by it (`cancel_refunding`) also `refund:create` |
| Mark as delivered | `fulfillment:update`, `order:update` |
| Refund | `refund:create`, `order:update` |
| Accept a return | `return:create`, `return:update`, `order:update`; with `refund_amount` also the refund rights |

A wildcard such as `*:*` or `order:*` counts. Without the RBAC module, and on 2.22.0 to 2.22.2, every admin may do
everything, as before. `GET /admin/medusify/permissions` answers with these checks for the caller, so the app shows no
button that would end in a `403`.

**Canceling, and what applies without the option.** The app cancels through `POST /admin/medusify/orders/:id/cancel`, which
applies the rule in the table. Medusa's own `POST /admin/orders/:id/cancel`, which the Medusa admin in the desktop browser
uses, asks for `order:update` only and refunds every captured payment all the same. That is Medusa's behaviour, not
something the plugin opens, and **the plugin leaves it as it is by default**, so the desktop admin of an existing shop
does not change. A role that holds `order:update` but not `refund:create` can therefore still give money back by canceling
there. To close that, set `strictCancelRefund: true`: a middleware on Medusa's cancel route then applies the same rule as
the app's route (captured and not yet refunded money needs `refund:create` as well; an order without such money, or one that
does not exist, is handled by Medusa as before). Switch it on only after you know which roles cancel orders in your shop.
It needs Medusa's RBAC module; without it nobody is refused, as before.

**What the lock covers.** The app's cancel route checks the rule and cancels under one lock per order, and reads the order
inside the lock right before the cancel workflow, so two cancels of one order run one after the other and a second one sees
the first one's result. Medusa's own capture and cancel routes take no lock. Money that is captured through them in the
milliseconds between the check and the refund step of Medusa's cancel workflow is refunded without the check, and the
middleware of `strictCancelRefund` cannot hold a lock around Medusa's handler, so there the window is the time between its
check and the handler. With Medusa's default in-memory locking provider the lock holds within one server process; with
several backend instances use a shared provider (for example `@medusajs/medusa/locking-redis`).

**Retries.** The app makes one `idempotency_key` per attempt and sends it again unchanged when an answer got lost. For a
return the plugin stores the key and a fingerprint of the content on the return and takes a lock per order and key; a
return that Medusa rolled back frees its key. A refund is sent to Medusa's refund route with the key as well, so a second
tap cannot refund twice. The app keeps the key of an attempt while it runs: going back, closing the sheet and opening it
again with the same content sends the same key. Another amount or other items start a new attempt with a new key. After
a lost answer the app sends nothing more for that payment or order until it has read the order again; if the order then
shows less to refund or fewer units to return, it counts the first try as done and starts again from the current order.
The key lives in the memory of the open app only: if the app is closed and opened again after a lost answer, the first
look at the order has to show whether it went through.

**Accepting a return** runs Medusa's return workflows in one go: create the return, request the items, confirm, receive
them, confirm the receipt, and, with `refund_amount`, refund. Before anything is written the plugin checks that the items
were shipped and are not on another return, and that the refund is not more than what is still refundable. A return made
this way carries `metadata.medusify_source = "app"`. The plugin sends no "return requested" push for it, since the person who entered it is already looking at it.

### Catalog and stock

Stage 2 of the app (plugin 0.3.0) lists products, changes a price or the stock, scans barcodes and creates a product.
Everything the app can do with Medusa's own routes it does with them (product status, variant barcode, photo upload); the
plugin adds the routes the app cannot do safely itself.

| Action | Rights (all of them) |
| --- | --- |
| See products, detail, barcode lookup (`catalog`) | `product:read`, `product_variant:read` |
| Change a price or a barcode (`variant_edit`) | `product_variant:update`, `product:update` |
| Draft or visible (`product_status`) | `product:update` |
| Count or change stock (`stock`) | `inventory_item:read`, `inventory_level:update` |
| First count at a new location (`stock_new_level`) | `inventory_level:create` |
| Quick create (`product_create`) | `product:create`, `product_variant:create`, `inventory_item:create`, `inventory_level:create`, `sales_channel:update` |
| Photo of a new product (`upload`) | `file:create` |
| Receives the low-stock push (`stock_read`) | `product:read`, `inventory_item:read` |

The plugin's routes use `authorizeIfAvailable` like the order routes: with the RBAC module they ask for the rights above,
without it (or on Medusa 2.22.0 to 2.22.2) every admin may, as before. A role without `catalog` sees an empty state in
the app, and the scanner and the new-product screen refuse the roles that lack their rights before anything is sent.
Stock is guarded like in Medusa: list, detail and lookup carry stock levels and totals only for a role with
`inventory_item:read`. Without it every variant comes with `stock_hidden: true`, no levels and no total.

**Prices.** Medusa's price update replaces the prices of a variant with the list it is given and deletes the ones that are
not in it. The route therefore reads the whole list under a lock per variant and sends it back with only the one base price
changed: other currencies, region prices and quantity tiers stay, two phones changing two currencies at once do not drop
each other's change. Only a *base* price (no rule, no quantity tier) can be changed here; the rest is shown as read-only
and stays for the Medusa admin. Prices of a price list (a sale, a customer-group list) belong to their list: they are not
shown as the variant's price and not sent back, which is also what Medusa's update expects. An amount with more decimals than the currency has is refused (`400 medusify:amount_decimals`).

**Stock.** The app counts what the Medusa admin calls "stocked quantity". `adjust` and `undo` change it by a difference
with Medusa's atomic adjustment, so a scan on one phone and a count on another do not overwrite each other. `set` is a
count: the plugin computes the difference to what is there under a lock on the inventory item and books that. Every
request carries an `idempotency_key`; the plugin stores it with the result in `medusify_operation`, so a retry after a lost
answer (a scan at the edge of the Wi-Fi) is answered from the first try and books nothing. An `undo` takes back exactly the
difference of the request it names, not "the old number", and an undo for a request that never arrived leaves a marker so
that the request which arrives late changes nothing. Below zero is refused (`400 medusify:below_zero`). A location where
the item has no level yet is created by the first change, if the role has `stock_new_level`. Kits (a variant that needs
several inventory items or more than one unit of one) and variants that do not track stock are shown but not counted; the
count is for the Medusa admin. Stock changes made by the app emit `inventory-level.updated` with `source: "medusify"`.

**Quick create** runs as one Medusa workflow: inventory item with its level, product with one variant, price, photo,
default sales channel and default shipping profile of the shop, then the key is stored. A failure in the middle rolls the
earlier steps back with Medusa's own compensation, so the shop does not keep half a product. The currency must be one the
store supports, the location must exist. More (options, more variants, texts, categories) stays in the Medusa admin.

### Push kinds

| Kind | Event | Switchable |
| --- | --- | --- |
| New order | `order.placed` | no |
| Canceled order | `order.canceled` | yes |
| Return requested | `order.return_requested` | yes |
| Low stock | `inventory-level.updated`, `reservation-item.created` | yes (on by default) |

**Low stock.** A device gets "{shop}: Bestand niedrig" (or "Ausverkauft" at zero) when the units that can be sold of a
product, summed over all its locations, fall to the device's threshold or below. The threshold is set per device and shop
in More (default 5, 0 to 9999; 0 means only when it is gone). A reservation (a new order) and a stock change in the
Medusa admin trigger it as well; a count made in the app does not (`source: "medusify"`), because the person who made it
is looking at it. Each device gets at most one message per product in a rolling 24 hours, and the count does not reset when
the stock goes back up, so a product that hovers around the threshold does not ring all day. The throttle is one atomic
statement on `medusify_stock_alert` (`INSERT … ON CONFLICT … WHERE last_sent_at < cutoff RETURNING`), so two events at once
send one message. Only users with `stock_read` get it. The tap opens the product in the app.

Medusa 2.22.x has no event for a failed payment (checked in `@medusajs/core-flows` and `@medusajs/utils` 2.22.7), so
there is no push for it. The switches are stored per subscription, that is per device and shop, in the column
`disabled_kinds` of `medusify_push_subscription` (migration `Migration20261118211637`, run `medusa db:migrate`). Every
push is sent only to users with `order:read`, like the order push.

Each push carries `data: { url, kind, shop, badge }`. `badge` is the number of orders to ship in this shop at that
moment; the app adds the numbers of all shops and shows the sum on the app icon where the Badging API exists.

### How the dashboard numbers are defined

- **Revenue** = sum of the order summary's `current_order_total` **per currency**, never mixed, over the orders of the
  period that are not canceled or draft **and whose payment is authorized or captured** (Medusa's aggregated
  `payment_status`: `authorized`, `captured`, `partially_refunded`). Unpaid orders (for example a draft order that
  was never paid) and fully refunded orders do not count, neither in the amount nor in `orders`.
  `partially_captured` and `partially_authorized` do not count either, because part of the order is unpaid.
  `current_order_total` already has refunds and returns taken off (measured on 2.22.7: 44.98 paid and 5 refunded
  gives 39.98, fully refunded gives 0), so nothing is subtracted a second time.
- **Today / this month** = from local midnight / first of the month in the `tz` you pass (default `UTC`), by the
  order's creation time.
- **To ship** = status pending/requires_action, payment captured **or partially refunded**, fulfillment not yet
  shipped (`not_fulfilled`, `partially_fulfilled`, `fulfilled`, `partially_shipped`). Medusa reports any refund as
  `partially_refunded` and the admin order list shows it as a warning next to the open fulfillment, so such an order is
  still shipped. A fully refunded order and an order that is only authorized (not captured) are not counted. The app
  applies the same rule to its order list. Payment and fulfillment status are computed by Medusa in memory (same
  logic as the admin order list), so this counts open orders page by page.
- Amounts are in major units, exactly as Medusa stores them (49.99 is 49.99).

## Several shops, one app

The app can watch several shops at once. One VAPID key pair identifies you, the merchant, to the push services:

1. **Use the same VAPID pair in every shop** (same `MEDUSIFY_VAPID_*` values). The phone subscribes once; the app then
   registers that subscription with each shop (`POST /admin/medusify/push-subscriptions` per shop). With different
   pairs a device could only be subscribed to one of them.
2. In every shop **set a different `storeLabel`** so you see which shop an order came from.
3. The app talks to every shop's admin API directly from the browser, so each shop must allow the **origin the PWA runs
   on** in CORS. When the PWA runs on shop A (`https://a.example.com/medusify/`), shop B needs, in its environment:

   ```bash
   ADMIN_CORS=https://admin.b.example.com,https://a.example.com
   AUTH_CORS=https://admin.b.example.com,https://a.example.com
   ```

   (comma-separated, scheme + host, no path, no trailing slash; keep the values you already have and **append** the PWA
   origin). Restart the backend after changing them.
4. Each shop still has its own admin users: sign in once per shop in the app.

## Cloudflare Access (or any SSO proxy) in front of the admin

If your admin host is protected by Cloudflare Access, a home-screen web app **loses the Access session**: Access sets its
cookie via a redirect login in the browser, and an installed iOS web app has its own cookie jar and can't complete that
redirect inside its standalone window. The symptom is a CORS error or a 302 to `cloudflareaccess.com` for every API call.
Options, from least to most invasive (this plugin changes nothing on your proxy):

1. **Exempt the API paths the app uses**: an Access *bypass* policy for `/admin/*`, `/auth/*` and `/medusify/*` on the host
   the PWA talks to. Medusa's own admin auth (password + MFA) still protects them. This is the simplest and the
   recommended setup.
2. **Service token**: Access *Service Auth* with a token sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret`
   headers. Needs a small proxy because a browser app must not carry a long-lived secret.
3. **Keep Access** and use a longer session duration; installed apps then need a re-login about as often as the session
   expires.

Whichever you choose, test from the installed app, not only from Safari. Push messages themselves don't pass through your
proxy (they come from Apple/Google), so they keep working either way.

## Development

```bash
npm install
npm run typecheck
npm run build                 # medusa plugin:build → .medusa/server
```

Integration tests need Postgres and Redis. Throw-away containers, memory-capped and without swap:

```bash
podman run -d --name medusify-pg    --memory 1g   -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=medusify_test postgres:17-alpine
podman run -d --name medusify-redis --memory 256m -p 127.0.0.1:56379:6379 redis:7
./scripts/run-tests.sh        # own process group, hard timeout (TEST_TIMEOUT, default 900 s)
```

The plugin is built and tested against the oldest and the newest Medusa version of its peer range (CI runs both).
`./scripts/test-medusa-versions.sh` does the same on your machine for 2.22.1 (or any versions you pass, `newest` for the
highest one allowed): it installs exactly that version into a scratch copy, reads the installed versions back, and runs
typecheck, build, a load of every compiled file, the unit tests and the integration tests. Roles only exist from
Medusa 2.22.3, so the specs about roles are skipped on older versions.

`npm run test:unit` needs no containers; it checks that no source file sits under a path segment (`test`, `unit-tests`,
`integration-tests`) that `medusa plugin:build` leaves out of the package.

Notes:

- The test runner connects to `localhost` (with `127.0.0.1` it forces SSL and a plain Postgres container hangs).
- `web-push` is mocked in the specs; VAPID test keys are generated at runtime in `integration-tests/setup.js`, nothing
  key-like is committed.
- Test with a real shop: `npx medusa plugin:publish` here, then `npx medusa plugin:add <package name>` in the shop and
  `npx medusa plugin:develop` here to watch changes.
- Generate a migration after changing the data model: `npm run db:generate` (needs `DB_*` env vars of a scratch database).

## Security notes

- The private VAPID key lives only in the plugin options (your environment), never in the database and never in an API
  response (a test asserts this).
- `/medusify/*` serves only files below the bundle directory. Encoded traversal (`%2e%2e`, `..%2f`, double encoding, NUL,
  backslashes), absolute paths and symlinks pointing outside are rejected (`400`); a missing file with an extension is a
  real `404`, only extension-less paths fall back to `index.html`.
- A device can only delete its own admin user's subscription.
- Every answer under `/medusify` carries a Content-Security-Policy (scripts only from the app itself, no framing),
  `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. The policy is in `src/lib/static.ts`; the reasoning is in
  [`docs/SECURITY.md`](https://github.com/andreasfilimon/medusify/blob/main/docs/SECURITY.md).

## License

MIT
