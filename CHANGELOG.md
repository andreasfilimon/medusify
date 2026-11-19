# Changelog

All notable changes to Medusify. The plugin (`medusify`) and the app in `pwa/` share one version number.

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
