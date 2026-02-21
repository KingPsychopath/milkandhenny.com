# Canonical Host and Redirects

This note explains why host canonicalization exists (`milkandhenny.com` vs `www.milkandhenny.com`) and why it matters operationally.

---

## What "canonical host" means

A canonical host is the one true hostname your app treats as primary.

Example:

- Input host: `https://milkandhenny.com`
- Canonical host: `https://www.milkandhenny.com`

Non-canonical hosts should redirect to the canonical one.

---

## Why redirects exist

Using one canonical host prevents duplicate surfaces and policy drift:

- SEO consistency (one indexed URL per page)
- Analytics consistency (traffic not split across hosts)
- Cookie/session consistency (fewer edge-case host mismatches)
- Cache consistency (single cache key space)
- Security consistency (one expected origin for sensitive requests)

---

## Why this matters for you

For auth-sensitive CLI/API calls, redirects can break auth if `Authorization` headers are dropped on follow-up redirected requests by a client/proxy path.

Observed symptom:

- Login/verify appears successful
- Next protected endpoint returns `401 Unauthorized`

This can happen when calling one host that redirects to another.

---

## How it affects this repo

The CLI auth commands now resolve canonical host first, then run requests on that final origin:

- `pnpm cli auth sessions`
- `pnpm cli auth revoke`
- `pnpm cli auth diagnose`

This avoids redirect-induced auth-header loss and keeps in-process token cache behavior consistent across `www` and non-`www` input.

---

## Quick checks

Use:

```bash
pnpm cli auth diagnose --admin-password <password> --base-url https://milkandhenny.com
```

If verify succeeds but protected probes fail:

1. Check `AUTH_SECRET` consistency across environments/instances.
2. Check CDN/proxy redirect/header behavior for `Authorization`.

---

## Practical rule

Treat canonical host resolution as part of auth hygiene:

- Human-facing links can redirect.
- Machine auth flows should prefer canonical origin directly.
