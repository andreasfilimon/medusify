# Medusify app

The installable web app for Medusa shops: a start screen with revenue and open shipments, orders, shipping with a tracking
number (camera scan or typing), and notifications for new orders. The plugin in `../plugin` serves it under `/medusify` of
the shop. Session and security model: [`../docs/SECURITY.md`](../docs/SECURITY.md).

Stack: React 19, Vite 7, TypeScript, wouter, TanStack Query, zxing-wasm. No server components, no cloud services.

## Commands

```bash
npm ci
npm run typecheck        # tsc --noEmit
npm test                 # Vitest (unit tests, jsdom)
npm run build            # writes to ../plugin/pwa-dist
npm run e2e              # Playwright against the dev shop (see below)
npm run shots            # screenshots to ../docs/shots/
npm run mocks            # renders the design mocks in ../docs/mocks (see ../docs/DESIGN.md)
```

The build output `../plugin/pwa-dist` is packed with the plugin (`"files"` in `plugin/package.json`) and is committed, so
a change to `src/` comes with a rebuilt bundle.

## End-to-end tests against the dev shop

The dev shop lives in `../dev-shop` (Medusa 2.22, Postgres and Redis in containers). It has to be running and serve the
built app under `/medusify`. The tests use WebKit with the iPhone 15 profile (sign-in with MFA, start screen, order,
shipment with tracking number, Google sign-in) and Chromium (service worker, offline page, push subscription at the
plugin, Content-Security-Policy). Google is replaced in the dev shop by `../dev-shop/src/modules/fake-google` (same
protocol, no Google project).

The shop's address comes from `E2E_BASE` (default `http://localhost:9055`). Install the browsers once with
`npx playwright install webkit chromium`.

`e2e/shots.mjs` writes screenshots at 390 px, light and dark, to `../docs/shots/` and records `scrollWidth` against
`innerWidth` in `overflow-check.json`.

## Layout

- `src/lib/` session, API, storage (IndexedDB), push, the Google return path (`oauth.ts`), formatting, texts (`i18n.ts`, de and en)
- `src/features/` sign-in, add shop, install hint
- `src/screens/` start, orders, shipping, more
- `src/ui/` building blocks
- `public/sw.js` the service worker: offline page and push only
- `test/` unit tests, `e2e/` Playwright tests
- `tools/` icon rendering and the design mock renderer

## Limits

Not verified on a real iPhone: Google sign-in in the installed app, the session after "Add to Home Screen", the real push
service, the camera. Details are in `../docs/SECURITY.md` under "Not verified".
