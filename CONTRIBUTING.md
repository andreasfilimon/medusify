# Contributing

Thanks for helping. Open an issue first if you plan a larger change, so we can agree on the direction.

## Layout

- `plugin/` the Medusa plugin. Integration tests run against a real Medusa app with Postgres and Redis.
- `pwa/` the app. Unit tests (Vitest) and end-to-end tests (Playwright) live here.
- `dev-shop/` a local Medusa shop with demo data that serves the built app. The end-to-end tests run against it.

## Run the tests

Node 22.22 or newer is required.

**App, no containers needed:**

```bash
cd pwa
npm ci
npm run typecheck
npm test                 # Vitest, jsdom
npm run build            # writes the bundle to ../plugin/pwa-dist
```

**Plugin typecheck and unit tests:**

```bash
cd plugin
npm ci
npm run typecheck
npm run test:unit
```

**Plugin integration tests** need Postgres and Redis. Throw-away containers on local ports:

```bash
podman run -d --name medusify-pg    -p 127.0.0.1:55432:5432 -e POSTGRES_PASSWORD=medusify_test postgres:17-alpine
podman run -d --name medusify-redis -p 127.0.0.1:56379:6379 redis:7
cd plugin && ./scripts/run-tests.sh
```

Use `docker` instead of `podman` if you prefer. The script reads `DB_PORT`, `DB_PASSWORD` and `REDIS_URL` from the
environment if your ports differ. Remove the containers when you are done.

**End-to-end tests** run against the dev shop, which serves the packed plugin:

```bash
cd plugin && npm run build && npm pack --pack-destination ../dev-shop
cd ../dev-shop              # follow dev-shop/README.md: install, .env, migrate, seed, create the admin, enroll MFA
npx medusa develop          # http://localhost:9055
cd ../pwa && npx playwright install webkit chromium && npm run e2e
```

After you change plugin code, rebuild and repack, reinstall the tarball in `dev-shop` and restart the shop. Otherwise
the tests run against the old plugin.

## Pull requests

- Keep a change to one topic. Add or update tests with it. For a bug fix, check that the new test fails without the fix.
- Run typecheck and the tests of the parts you touched before you push. If you change `pwa/src`, run
  `npm run build` in `pwa/` and commit the updated `plugin/pwa-dist`.
- New screens follow [`docs/DESIGN.md`](docs/DESIGN.md). Add texts in German and English in `pwa/src/lib/i18n.ts`.
- Use demo data only. Never commit real customer data, shop addresses with credentials, or keys.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org), in English, imperative, no emojis:

```
fix(pwa): keep the token out of the store after sign-out
feat(plugin): push only to admins who may read orders
docs: explain the CORS setup for a second shop
```

Types in use: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`. Scopes: `plugin`, `pwa`, `dev-shop`, `docs`.

## Security issues

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).
