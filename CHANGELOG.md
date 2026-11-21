# Changelog

All notable changes to Medusify. The plugin (`medusify`) and the app in `pwa/` share one version number.

## 0.5.0 - 2026-11-21

Stage 4: numbers and team. Needs plugin and app at 0.5.0 (one migration: three columns on the push subscription); on an
older plugin the reports screen shows a note and the daily summary row is left out.

### Added

- **Reports** (More → Berichte): a period (7 days, 30 days, this month, or chosen dates up to 400 days) next to the one
  of the same length right before it. Revenue, paid orders and average order value per currency (never added up or
  converted, refunds taken off), units sold and the share that came back, and the five products sold most. Plugin route
  `GET /admin/medusify/reports?from=&to=&tz=`, right `reports` (Medusa's `order:read`).
- **Daily summary push**: per device and shop, at a chosen hour on the device's clock: the day's orders, revenue per
  currency and orders to ship. Off by default; sent once a day, also with several backend processes (scheduled job
  `medusify-daily-summary`, every 15 minutes). `POST /admin/medusify/push-preferences` takes
  `{ endpoint, daily_summary: { hour, tz } | null }`.
- **Your rights** (More → Deine Rechte): what the signed-in role may do in each shop, in plain words.
  `GET /admin/medusify/permissions` also says whether the shop uses roles at all (`rbac`).

### Changed

- More hides Berichte, Kunden and Rabattcodes when no signed-in shop allows them.

## 0.4.0 - 2026-11-20

Stage 3: customers and special cases. Needs plugin and app at 0.4.0; on an older plugin the new screens show a note and
everything else works as before.

### Added

- **Customers** (More → Kunden): list with search, orders, spent and last order per customer; profile with contact,
  addresses, groups and the customer's orders; the order detail links to the profile. Plugin routes
  `GET /admin/medusify/customers` and `GET /admin/medusify/customers/:id`.
- **Discount codes** (More → Rabattcodes): list with status, value and uses; create a code (per cent or amount, optional
  limit) and pause or resume it, through Medusa's own promotion routes. A lost answer to a create does not make a second
  code.
- **Order by hand** (Orders → +): customer or guest email, items from the catalog, shipping or pick-up, address (filled
  from the customer's default address), "money already received". Plugin routes `GET /admin/medusify/orders/setup` and
  `POST /admin/medusify/orders` (one workflow, idempotent per key, also when a try stopped half-way). After a lost
  answer the form stays locked until the app has asked the shop (`GET /admin/medusify/orders/attempts/:key`), also after
  leaving the screen.
- **Edit, exchange, claim** (order → Bearbeiten): change quantities or add items, take items back for others, record a
  broken, wrong or missing item for a refund or a replacement. The shop prices the change first; the merchant confirms
  that amount and the change is made only while it is still the same. Plugin routes
  `POST /admin/medusify/orders/:id/change/preview` and `POST /admin/medusify/orders/:id/change` (Medusa's order edit,
  exchange and claim; idempotent per key, one change per order at a time, a failed change is taken back).
- Eight rights in `GET /admin/medusify/permissions`: `customers`, `discounts`, `discount_create`, `discount_edit`,
  `manual_order`, `order_edit`, `exchange`, `claim`.

### Fixed

- Plugin: amounts that Medusa hands out as `BigNumber` objects (order previews, summaries) were read as 0.
- A product or customer deleted in the meantime showed "plugin too old"; a `404` that carries a `medusify:` code is now
  "not found".

## 0.3.0 - 2026-11-20

Stage 2: catalog and stock. The app lists products, changes prices and stock, scans barcodes, creates a product with a
photo, and warns when stock is low. Needs plugin and app at 0.3.0; an app on a shop with an older plugin shows a note on
the Products tab and works as before everywhere else.

### Added

- **Products tab** (a fourth tab) with search by name, SKU and barcode, a thumbnail, price and a stock chip per product.
  Plugin routes `GET /admin/medusify/products`, `GET /admin/medusify/products/:id`, `GET /admin/medusify/variants/lookup`.
- **Product detail**: change the plain price of a currency (`POST /admin/medusify/variants/:id/price`; the plugin sends
  Medusa the whole price list under a lock per variant, because Medusa's update deletes every price that is not in the
  list), count or change the stock per location with a stepper and one save (`POST /admin/medusify/inventory`, always
  with an `idempotency_key`; a repeat changes nothing), start the stock at a new location, and a switch for draft or
  visible.
- **Scanner mode**: "+1 pro Scan" books one unit per scan with an undo and a resend after a lost answer; "Zählen" counts
  first, per product and place, and writes the counts when applied; scans that arrive while it writes stay for the next apply. A code that matches several products asks which one, and an unknown code can be
  assigned to a product, which writes it to the variant's barcode. Kits and variants without stock tracking are not counted.
- **Quick create** (`POST /admin/medusify/products`): photo (scaled to 1600 px, uploaded through Medusa's file module),
  name, price, starting stock, location, draft or published, as one workflow that rolls back as a whole.
- **Low-stock push**, a third optional push kind, on by default. A device gets one message per product in a rolling 24
  hours when the sellable units fall to its threshold (More, default 5, 0 to 9999); a message that failed does not count.
  Counts made in the app do not trigger it. Tapping the message opens the product. `GET`/`POST /admin/medusify/push-preferences` now also carry `low_stock` and `low_stock_threshold`.
- Eight rights in `GET /admin/medusify/permissions`: `catalog`, `variant_edit`, `product_status`, `stock`,
  `stock_new_level`, `product_create`, `upload`, `stock_read` (all through `authorizeIfAvailable`, so Medusa 2.22.0 to
  2.22.2 and shops without RBAC behave as before).
- Stock follows Medusa's own right: the catalog answers carry stock only for a role with `inventory_item:read`; otherwise
  `stock_hidden: true` and the app says the role may not see stock.
- Two tables (`medusify_operation`, `medusify_stock_alert`) and a column (`medusify_push_subscription.low_stock_threshold`):
  run `medusa db:migrate` after the update.

### Fixed

- The sign-out notice no longer promises a fixed 10-hour expiry for a session the shop could not end. Shops can set
  their own session lifetime (`sessionOptions.ttl`, optionally `rolling`), so the text names the shop's lifetime and
  Medusa's 10-hour default.

## 0.2.3 - 2026-11-19

### Changed

- New logo: a rounded hexagon ring whose roof lifts off the base (headless, built on Medusa). App icon, maskable icon,
  apple-touch-icon and favicon are new; the favicon uses a small cut that stays readable at 16 px. Source and rules in
  `docs/logo/`.
- The app's accent is Medusa's blue instead of petrol (`#1D4ED8` light, `#60A5FA` dark), so the app sits next to the
  Medusa admin as one family. All 34 contrast pairs pass WCAG AA in light and dark mode, also on the translucent bars.

## 0.2.2 - 2026-11-19

### Fixed

- Shipping no longer leaves an order half done. The app used to make Medusa's two calls itself (pack, then ship); when
  iOS put the app away between them, the order stayed packed but not shipped, and the customer got no mail. The new
  plugin route `POST /admin/medusify/orders/:id/ship` does both on the server, under one lock per order. A repeat, a
  double tap or a second phone finds the work done and changes nothing. A packed order left behind by an earlier try is
  finished by the next one. The call ends after 45 seconds instead of keeping the form busy.
- The label a carrier integration writes when the package is packed (number, tracking link) is kept. Medusa replaces the
  labels of a fulfillment with the list in the shipment call, and the app sent only the typed number, or none.
- Goods without shipping (a voucher, a download) are split from the parcel and marked as delivered, as Medusa requires.
- The scanner reads the parcel number on labels with several codes. It took the first code of a frame, which on a GLS
  label is a DataMatrix with address data; it now takes the 1D code (ITF, Code 128 …) and asks the camera for a sharper
  picture. A number the user typed is no longer replaced by the camera. If the decoder fails to load, the camera closes.
- An order with a delivered voucher and goods still to send counts as "to ship" in the app, the queue and the dashboard.
  Medusa reports such an order as partially delivered, and its order list even as delivered; the line quantities decide
  now.
- The ship queue loads the next page when the first one holds nothing to ship, and says how many orders were skipped.
  A shop whose page failed to load no longer ends the queue with "all shipped"; the queue shows the error with a retry.
- A typed number goes on one package only. With several open packages and no number of their own, the shop answers
  400 `medusify:numbers_required` and the form asks for a number per package. A number a package carries already stays
  there, and the tracking link goes with the typed number only.
- When the typed number found no package (all were shipped before, each with a number), the app says so instead of a
  plain "done".
- Goods with different shipping profiles are packed from the stock location of their own shipping option.
- A carrier label keeps its `label_url`, also a relative one.

### Changed

- The tracking number is optional. Packages packed earlier show their carrier label, or get a field of their own.
- The ship sheet cannot be closed while the request runs. A role without the right to ship sees why (`ship` in
  `GET /admin/medusify/permissions`).
- An app on a shop with an older plugin (no ship route) makes Medusa's calls itself, now with the labels kept.

## 0.2.1 - 2026-11-19

### Fixed

- A refund that the shop answers with "still in progress" (409) now counts as unknown, not as refused. The app keeps the
  idempotency key and the lock until the order has been read again, so a retry cannot become a second refund.

### Security

- Development dependencies raised to patched versions through `overrides` (zod 4.6.7, ajv 8.20, uuid 11.1.1). They came in
  through Medusa's own packages and only affect the plugin's test setup and the dev shop, not shops that install Medusify.
  `npm audit` reports 0 vulnerabilities in `plugin/` and `dev-shop/`.

## 0.2.0 - 2026-11-18

### Added

- Edit an order in the app: capture a payment, mark it as paid, cancel the order, mark a shipment as delivered.
- Refund in full or in part. The app checks the amount against what is still refundable before it asks the shop. A
  confirmation sheet shows amount, currency and shop, and only its red button sends the refund. A double tap sends one
  request.
- Accept a return: choose items and quantities, confirm the receipt, refund right away if wanted. New plugin route
  `POST /admin/medusify/returns`, which runs Medusa's return workflows in one step.
- Phone and email of the customer as `tel:` and `mailto:` links in the order detail.
- A number on the app icon (`navigator.setAppBadge`): the orders to ship over all shops, set when the app opens and on
  every push. The push payload carries the number of the shop that pushed.
- Pushes for canceled orders and return requests, switchable per kind in More, per device and shop. Stored in the new
  column `disabled_kinds` of `medusify_push_subscription` (migration `Migration20261118211637`, run `medusa db:migrate`).
- New plugin routes `GET /admin/medusify/permissions`, `GET` and `POST /admin/medusify/push-preferences`. The dashboard
  answer carries `shop_label`.
- Rights: the return route and the permissions route check the same rights as Medusa (`authorize`, from 2.22.3); the app
  hides actions the user may not do.
- A new look after iOS 26, kept calm. The tab capsule floats, and navigation bar, sheets and toast use a translucent
  control material (never on content). Also new: concentric corners, springs for sheets and presses, page changes with View
  Transitions and the order title traveling from the row into the detail, a large title that shrinks into the bar, a
  swipe on an order row for ship or paid, sheets with half and full position and pull-away, pull to refresh, changed
  digits that roll in, "mark as delivered" shown at once and put back if the shop refuses, row skeletons, a monogram
  gradient per shop, a new app icon and splash screen. Display P3 colors with an sRGB fallback; every motion has a
  `prefers-reduced-motion` version. In the installed app a swipe from the left edge goes back one page. The install hint on iPhone is one quiet row until tapped. No new dependency and no web font.
- `POST /admin/medusify/orders/:id/cancel`, and `cancel_refunding` in the permissions answer: canceling an order whose
  captured money Medusa would refund needs the refund right too.
- A retry of a return or a refund after a lost answer carries one `idempotency_key` per attempt and makes no second return
  or refund. The key stays the same when the user goes back, closes the sheet or opens it again with the same content.
  After a lost answer nothing is sent for that payment or order until the order has been read again; if it then shows
  less to refund or fewer units to return, the sheet starts again from the current order.
  The lock starts at the moment the answer is lost and ends only when the order has been read after that; leaving the order
  screen while the refresh runs does not count as a read. "Try again" on the order's error screen counts, and so does
  "Reload order" in the sheet.
- Plugin option `strictCancelRefund` (default `false`): Medusa's own `POST /admin/orders/:id/cancel` then also asks for the
  refund right when captured money would be refunded, the same rule as `POST /admin/medusify/orders/:id/cancel`. Off by
  default so that the desktop admin of an existing shop does not change; the README says what applies without it.
- The app's cancel route checks the refund rule and cancels under one lock per order (Medusa's locking module), and reads
  the order inside the lock right before the workflow. Three parallel cancels of one paid order used to give two successes.
  Medusa's own capture and cancel routes take no lock; the README names that remaining window.

### Changed

- The sheet head has Cancel left, the title in the middle and the forward action right; confirmation sheets keep the
  red button at the bottom. The back button shows only a chevron. "Refund" has its own symbol and the red button a
  clear red with white text. "All (€ …)" in the refund amount is a chip inside the field.

- The plugin checks its code against Medusa 2.22.1 and the newest 2.22.x in CI and in
  `plugin/scripts/test-medusa-versions.sh`. A direct import of `authorize` crashed a backend on 2.22.1; it is now
  loaded only where it exists.

### Known gaps

- Medusa 2.22.x fires no event for a failed payment, so there is no push for it.
- Two shops with the same `storeLabel` cannot be told apart by a push; the icon number then waits for the next open.

## 0.1.0

First release: orders and revenue, shipping with a tracking number (camera scan or typing), push for new orders,
several shops in one app.
