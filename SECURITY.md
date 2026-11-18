# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting instead:

1. Open the **Security** tab of this repository.
2. Choose **Report a vulnerability** and describe what you found, how to reproduce it, and which version you tested.

I will confirm receipt, look into it, and tell you what I plan to do. Please give me a reasonable time to ship a fix
before you publish details.

## Supported versions

Only the latest release of the `medusify` package receives fixes.

## Scope

In scope: the plugin in `plugin/` (admin routes, push subscriptions, the static file handler under `/medusify`) and the
app in `pwa/` (sign-in, session and token handling, service worker).

Out of scope: vulnerabilities in Medusa itself (report them to the Medusa project), and shops that are configured
unsafely, for example an admin API open to the internet without Medusa's own authentication.

How the app handles sessions and tokens, and what has and has not been verified, is described in
[`docs/SECURITY.md`](docs/SECURITY.md).
