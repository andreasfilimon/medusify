# Medusify app: session model and security

As of 2026-11-17, Medusa 2.22.7. Everything marked "measured" was run against the dev shop in `dev-shop/`. What could
not be measured is listed under "Not verified". To report a vulnerability, see [`../SECURITY.md`](../SECURITY.md).

## What the app protects

The app shows orders, revenue and customer addresses, and it can create shipments. Whoever holds its session can do the
same. So the things to protect are the credentials (email, password, MFA code), the session itself, and the push
subscriptions. Order, customer and address data stay in memory and are never written to the device.

## Threat model

| Threat | Measure | Residual risk |
|---|---|---|
| Lost or borrowed device | The phone's lock. Signing out deletes everything (see below). The session expires. | Until it expires, the session is valid on an unlocked device |
| Script in the page context (XSS) reads a token | Home shop: the token is never available to script (httpOnly cookie). Other shops: the bearer token is in IndexedDB and would be readable. A Content-Security-Policy restricts scripts to the app's own files (see below). | With XSS, other shops' tokens would be readable. The app renders no foreign HTML, uses React's escaping, and loads no third-party script |
| Token in URL, history, referrer, log | No token in URLs. The plugin's responses set `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff` | During the Google return, `code` and `state` are briefly in the URL (see Google) |
| Stale answers or data in a cache | Every shop call uses `cache: "no-store"`. The service worker stores only the offline page (a test checks for exactly one `.add(` and no `.put(` or `.addAll(`; the end-to-end test checks the cache contents) | None |
| A foreign server pretends to be Medusa | When you add a shop, the app checks that `/admin/users/me` answers a JSON 401 without a login. Sign-in works only over https (http only on loopback). Password and token go only to the address you typed | A malicious shop that you add on purpose receives your credentials. That is by design, it is your shop |
| Push subscription survives sign-out | Signing out first removes the subscription at every shop, then ends the session (the end-to-end test checks that the row disappears from the plugin table) | If a shop is unreachable at sign-out, its subscription stays there. The app names those shops after signing out |
| Sign-in CSRF through the Google callback | `state` is stored in `sessionStorage` at the start and compared on return (see Google) | See "Not verified" about iOS |
| Framing, content sniffing | `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` | None known |

## Content-Security-Policy

The plugin serves the app under `/medusify` and sets this policy on every answer of that handler, including redirects and
errors (`plugin/src/lib/static.ts`):

```
default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:;
font-src 'self'; connect-src 'self' https: http://localhost:* http://*.localhost:* http://127.0.0.1:*; worker-src 'self';
manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

- `connect-src` allows any https origin because the app talks to every shop the merchant adds. Plain http is allowed
  only for `localhost`, its subdomains and `127.0.0.1`, the same rule as in the "add shop" check. An IPv6 literal such as `[::1]` is not a
  valid CSP host source in Chromium and WebKit, so the app does not accept it either.
- `img-src` allows https because product thumbnails come from each shop's file host.
- `'wasm-unsafe-eval'` is needed to compile the barcode decoder (WebAssembly). It does not allow `eval()`.
- The offline page has one inline `<style>` block. The handler computes its sha256 and adds it to `style-src` for that
  file only. There is no `'unsafe-inline'`.
- Medusa sets its own `frame-ancestors 'self'` policy on all responses. The handler replaces it for `/medusify` with the
  stricter one above.

Measured: the integration test `plugin/integration-tests/http/medusify-static.spec.ts` checks the policy on 200, 404, 400
and 308 answers and checks that the script sources contain no `'unsafe-inline'` or `'unsafe-eval'`. The end-to-end test
`pwa/e2e/csp.spec.ts` loads the app with the policy active and fails on any `securitypolicyviolation` event or CSP
message in the console.

## Where each token lives

| What | Where | Lifetime | Script access |
|---|---|---|---|
| Session of the home shop (the shop the app was loaded from) | httpOnly cookie, set by `POST /auth/session` | 10 hours from sign-in, not extended (measured) | No |
| Bearer JWT of another shop | IndexedDB `medusify`/`kv`, inside the shop entry | 24 hours (measured: `exp - iat = 86400`). On a 401 the app tries `POST /auth/token/refresh` once, otherwise you sign in again | Yes, same origin |
| JWT right after signing in at the home shop | In memory only, exchanged for the cookie at once and dropped | Seconds | Only in that moment |
| MFA intermediate token (after password, before code) | In memory of the sign-in form only | Short, valid only for the confirmation | Yes, in memory |
| Password, MFA code | Only in the input field and the one request. Never stored, never logged | Once | No, only the input field |
| Shop list, name, color, push status | IndexedDB (same entry) | Until sign-out or removing the shop | Yes |
| Language, appearance, selected shop, install hint | `localStorage` (settings only). On sign-out the selected shop is dropped, language and appearance stay | Until deleted | Yes, contains no credentials |
| Google `state` (only during the return) | `sessionStorage`, deleted when read | One sign-in | Yes, a random value that is worthless to an attacker |
| Push subscription | Browser (push service) and the plugin table `medusify_push_subscription` | Until sign-out or removal | No (browser internal) |

A test (`pwa/test/sw.test.ts`) makes sure `localStorage` appears only in `src/lib/prefs.ts` and `sessionStorage` only in
`src/lib/oauth.ts`. Another (`pwa/test/store.test.ts`) makes sure tokens never reach `localStorage`.

## Signing out deletes everything

Order in `pwa/src/lib/session.ts` (`logoutAll`), tested in `pwa/test/session.test.ts`:

1. Remove the push subscription at every signed-in shop, while the credentials are still valid.
2. End the home shop session (`DELETE /auth/session`).
3. Clear IndexedDB (shop list and all tokens of other shops).
4. Remove the selected shop from the settings.
5. Cancel the push subscription in the browser.

An unreachable shop never blocks the local deletion. It is reported ("The notification subscription still exists at: ...")
and a home session that could not be ended expires on its own after 10 hours. Removing a single shop deletes its
subscription, then its token and entry.

## Google sign-in

Medusa 2.22.7 (measured) supports third-party sign-in for admins. The app asks `GET /auth/user/providers` (public,
filtered by `http.authMethodsPerActor`) and shows only what the shop allows: password only, Google only, or both. If the
answer is missing, the app shows the password form that every Medusa shop has.

Flow, measured against the dev shop with a stand-in provider that speaks the same redirect protocol:

1. `POST /auth/user/google` with `callback_url = <shop origin>/medusify/auth/google`. The shop answers with `location` (for
   the real Google, the authorization URL) and stores a single-use `state` on the server.
2. The app keeps the `state` from `location` in `sessionStorage` and redirects the browser there.
3. On return the address contains `?code=...&state=...`. The app removes both with `history.replaceState` before anything
   else runs and compares `state` with the stored value. If it differs or is missing, the app rejects (this stops someone
   from pushing a foreign callback into this browser).
4. `POST /auth/user/google/callback?code&state` returns a token. The `state` is single use (a second attempt gives 401, measured).
5. If the token has an empty `actor_id` (measured: the Google account is not mapped to an admin in the shop), the app
   starts no session and reports "no access". With such a token `/admin` answers 401.
6. Otherwise `POST /auth/session` (cookie), and the token is dropped.

The code is never logged. Mapping a Google account to an admin user (the allowlist) lives in the shop and belongs to the
shop operator.

**Measured, and important: Medusa asks for no second factor on Google sign-in.** On the dev shop the admin has TOTP
enrolled. With email and password the MFA prompt appears. The Google callback instead returns a full token
(`mfa_enabled: false`, `/admin/users/me` answers 200). The second factor is Google's. The Google account is therefore as
strong as its own protection (a passkey or a second factor at Google), and the operator needs to know that.

The redirect URI has to be registered with Google as an authorized redirect, exactly `https://<shop>/medusify/auth/google`.

Home shop only: the callback lands on the shop's own origin. For another shop that would be a different origin with
different storage. Other shops that allow only Google are shown as not signable ("This shop offers no sign-in method the
app knows"). The extension point is a return path that carries the token back to the app's origin, for example a window
with `postMessage` and a fixed origin check. It is not built.

In the dev shop, `dev-shop/src/modules/fake-google` replaces the real provider (same protocol, no Google project). It
trusts the account name from the browser and must never be used in a real shop.

## Service worker

`pwa/public/sw.js`, scope `/medusify/`:

- Stores exactly one file, the offline page. Nothing from the API, no pages, no images.
- Answers only page loads (`request.mode === "navigate"`), and only with the offline page on a network error.
- Push: always shows a notification (iOS revokes the subscription when a push stays silent). A tap opens only addresses
  under `/medusify/`.

The service worker is registered only in the production build.

## Push

Permission is requested only after a tap, and only in the installed app (in a Safari tab on the iPhone the app shows an
install hint). The subscription is registered at every signed-in shop that has the same VAPID key. A shop with a
different key is not registered and shows as an error.

## Roles in the shop (Medusa RBAC)

Medusa 2.22.7 can restrict admin users by role (module `@medusajs/medusa/rbac`, needs a Medusa license key; there is no
feature flag). Without the module every admin may do everything and the plugin routes behave as before. With it, the
dashboard (`GET /admin/medusify/dashboard`) and creating a push subscription
(`POST /admin/medusify/push-subscriptions`) require the same right as Medusa's own order routes, `order:read` (the
`authorize` middleware). Without the right the shop answers 403: no revenue, no order list, no subscription.

The push message for a new order goes only to subscriptions of users who have the right at the moment of the order. A
subscription created before a right was withdrawn stays and receives nothing. If the permission check fails, nothing is
sent to that user. Any signed-in admin may delete a subscription (`DELETE`), with or without the right.
Tested in `plugin/integration-tests/http/medusify-rbac.spec.ts` with the real RBAC module and a self-signed test license
(`MEDUSA_LICENSE_PUBLIC_KEY`), using a user with exactly `order:read`, one with `product:read`, and one without a role.

## Known limits and open points

- **Tokens of other shops are in IndexedDB**, not in a cookie. A cookie of another shop does not belong to the app's
  origin, so this is required. A script running in the app's origin could read them. The CSP lowers that risk and does not
  remove it.
- **Other shops need CORS.** The shop has to list the app's origin in `ADMIN_CORS` and `AUTH_CORS`. If it does not, the
  app says the shop does not allow it (a hint in the "Add shop" dialog).
- **`'wasm-unsafe-eval'` on iOS.** The policy needs it for the barcode decoder. Whether the camera scan works under this
  policy on a real iPhone is not verified (see below).

## Not verified (needs a device)

These points cannot be shown without an iPhone. The test on a device is outstanding:

- **Google sign-in in the installed iOS app.** The way to Google leaves the app's scope and iOS opens an in-app browser.
  The callback might land there (with its own storage), and then the `sessionStorage` `state` and the session cookie
  are missing in the app. The app rejects safely in that case (no `state`), but whether the flow works at all is open.
  The fallback is email, password and MFA, as long as the shop allows it.
- Session after "Add to Home Screen": WebKit separates the storage of the installed app from Safari. Reports say cookies
  are copied once when adding; there is no measurement for iOS 26. Home shop: the cookie session may come along, or not.
  Other shops: their tokens are in IndexedDB and do not come along, so a new sign-in is certain there. The install hint
  therefore says a new sign-in may be needed in the installed app.
- The real web push service (FCM, APNs): in the end-to-end test a stand-in replaces the browser subscription (Chromium
  refuses it in the non-persistent Playwright profile). Permission, tap, app logic, HTTP to the plugin and the database
  row are tested for real.
- Camera scan with a real camera and real parcel labels, and with the CSP active on iOS.
- Status bar, safe areas and installing on a real iPhone.
