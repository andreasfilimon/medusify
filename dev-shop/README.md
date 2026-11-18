# Dev shop for the medusify plugin

Local Medusa 2.22 shop (copy of the Medusa DTC starter backend) with the **packed** plugin installed, so you test what
a merchant gets from npm. Demo data only.

## Set up

```bash
# 1. build and pack the plugin into this folder
(cd ../plugin && npm run build && npm pack --pack-destination ../dev-shop)

# 2. install (the lockfile points at the tarball from step 1)
npm install

# 3. configuration
cp .env.template .env
npx web-push generate-vapid-keys      # put both keys into .env
# also fill JWT_SECRET, COOKIE_SECRET (random strings) and DATABASE_URL

# 4. database (any empty Postgres database), migrations incl. the plugin table, demo data, admin
npx medusa db:migrate
npx medusa exec ./src/scripts/seed-demo-products.ts
npx medusa exec ./src/scripts/seed-demo-orders.ts      # invented orders in every state, two currencies
npx medusa exec ./src/scripts/seed-demo-kit.ts         # an inventory kit product and a paid kit order (SEED_KIT_ORDERS=n adds more)
npx medusa user -e admin@devshop.invalid -p '<choose a password>'
node scripts/enroll-mfa.mjs                            # enrolls TOTP for that admin, writes .devshop-mfa (git-ignored)

# 5. run
npx medusa develop                    # http://localhost:9055
```

`scripts/devshop-token.mjs` logs in with the TOTP secret from `.devshop-mfa` and exports `devshopToken()` for scripts and tests.
To test the app against a second origin, add `http://127.0.0.1:9055` to `ADMIN_CORS` and `AUTH_CORS` (already in `.env.template`).

## Smoke test against the running shop

```bash
EMAIL=admin@devshop.invalid PASSWORD='<the password>' ../plugin/scripts/smoke-packed.sh
```

After a plugin change repeat step 1, run `npm install ./medusify-0.1.0.tgz` and restart the shop.
