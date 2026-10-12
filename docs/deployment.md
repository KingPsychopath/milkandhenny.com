# Deployment

## Portable artifact

The root `Dockerfile` is the production contract. It builds TanStack Start with Nitro's Node preset
and copies `.output`, operational scripts, and the pinned local semantic model into an unprivileged
runtime image.

Public browser configuration is supplied as Docker build arguments:

```text
VITE_BASE_URL
VITE_MEDIA_PUBLIC_URL
VITE_TRANSFER_MEDIA_BROWSER_PREP
VITE_MULTI_FILE_ZIP_URL
VITE_MULTI_FILE_ZIP_MODE
```

All credentials remain runtime variables.

Use two R2 buckets:

- `R2_PUBLIC_BUCKET=milkandhenny-pics`, connected to `pics.milkandhenny.com`;
- `R2_PRIVATE_BUCKET=milkandhenny-private`, with both custom-domain and `r2.dev` public access disabled.
- independent Object Read & Write credentials scoped to each bucket: `R2_PUBLIC_ACCESS_KEY` / `R2_PUBLIC_SECRET_KEY` and `R2_PRIVATE_ACCESS_KEY` / `R2_PRIVATE_SECRET_KEY`;
- the versioned CORS and lifecycle policies in [`ops/r2`](../ops/r2/).

Disable the private bucket's `r2.dev` URL as well as custom domains. Enable caching only on the public bucket's custom domain. A published file can be downloaded or cached by a visitor, so unpublishing stops future discovery and origin reads but cannot recall copies that already left the service.

Use separate R2 API tokens scoped to the public and private buckets. Never connect the private bucket to a public hostname.

Apply the checked-in policies with the [`cf` CLI](https://developers.cloudflare.com/cf/), after
`cf auth login` and checking the account with `cf auth whoami`. Add `--dry-run` first to validate
the request without applying it:

```bash
cf r2 buckets cors update milkandhenny-pics --body @ops/r2/cors-public.json --force
cf r2 buckets cors update milkandhenny-private --body @ops/r2/cors-private.json --force
cf r2 buckets lifecycle update milkandhenny-pics --body @ops/r2/lifecycle-public.json --force
cf r2 buckets lifecycle update milkandhenny-private --body @ops/r2/lifecycle-private.json --force
```

The public policy is browser read-only and supports published media plus ranged reads. Every browser upload stages in the private bucket, whose policy supports presigned PUTs, ranged reads, and authorised downloads. The private bucket expires abandoned word and album staging objects after one day. Transfer expiry also belongs there because transfer objects are never published. When adding another browser origin or signed request header, update the relevant policy and apply it explicitly.

The checked-in CORS policies are production policies and intentionally contain only the canonical apex and redirecting `www` origin. Do not add preview hosts or localhost origins to the production buckets. Use separate development buckets and policies when local browser-to-storage access is required.

## Credentials

Every external credential, the variable it fills and where it lives. Values never appear in the
repository; keep each one in Bitwarden under its target name, in the project's production
collection. Names follow `<project>-<env>-<holder>-<purpose>-<access>`; rename a provider credential only
together with this table.

| Provider credential (current name)                             | Variables                                        | Stored in                                                        | Scope                                                                | Target name                                       |
| -------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| Cloudflare user API token `milkandhenny-railway-email-send`    | `EMAIL_API_KEY`                                  | Railway `web`                                                    | Email Sending edit, one account                                      | `milkandhenny-prod-railway-email-send`            |
| Cloudflare account API token `prod-milkandhenny-public-r2-rw`  | `R2_PUBLIC_ACCESS_KEY`, `R2_PUBLIC_SECRET_KEY`   | Railway runtime variables                                        | Object read and write, `milkandhenny-pics`                           | `milkandhenny-prod-railway-public-r2-write`       |
| Cloudflare account API token `prod-milkandhenny-private-r2-rw` | `R2_PRIVATE_ACCESS_KEY`, `R2_PRIVATE_SECRET_KEY` | Railway runtime variables                                        | Object read and write, `milkandhenny-private`                        | `milkandhenny-prod-railway-private-r2-write`      |
| Stripe restricted key                                          | `STRIPE_SECRET_KEY`                              | Railway `web`                                                    | Checkout Sessions and Refunds write; PaymentIntents and Refunds read | `milkandhenny-prod-railway-stripe-checkout-write` |
| Stripe webhook signing secret                                  | `STRIPE_WEBHOOK_SECRET`                          | Railway `web`                                                    | The `/api/stripe/webhook` endpoint                                   | `milkandhenny-prod-railway-stripe-webhook`        |
| Generated shared secret                                        | `EMAIL_EVENT_SECRET`                             | Railway `web`; Worker secret on `milkandhenny-email-event-relay` | Email delivery-event relay                                           | `milkandhenny-prod-worker-email-events-write`     |

App-generated secrets (`AUTH_SECRET`, `CRON_SECRET`, `TRANSFER_MEDIA_WAKE_TOKEN`, `STAFF_PIN`,
`ADMIN_PASSWORD`, `UPLOAD_PIN`) and `DATABASE_URL` are not provider credentials. They live as
Railway runtime variables and in the same Bitwarden collection under their variable names.

Cloudflare does not record a last-used date for Email Sending or for R2's S3 endpoint, so an empty
date on these tokens is not evidence that they are unused. Confirm with the application logs before
revoking one. An older combined account token, `prod-milkandhenny-r2-rw`, predates the per-bucket
tokens above and is not referenced by the current configuration.

## Railway

`railway.toml` selects the Dockerfile, `/api/health`, and an on-failure restart policy. Start with one replica, 512 MB–1 GB memory, 0.5–1 vCPU, and no persistent volume.

The canonical production origin is `https://milkandhenny.com`. Cloudflare redirects
`www` to the apex host while preserving the path and query string.

The web service owns product-time jobs and daily housekeeping through durable
Postgres leases. No separate maintenance service or cron scheduler is required.

### Safe Railway release

Run the release gate from the repository root:

```bash
pnpm verify:release
```

Then deploy the verified tree:

```bash
railway up --detach -m "release: describe the change"
```

Wait for the new deployment to reach `SUCCESS`. A queued or building
deployment is not a completed release. After it succeeds, check the health
endpoint and canonical origin:

```bash
curl --fail https://milkandhenny.com/api/health
curl --fail -I https://milkandhenny.com/
```

Railway watches application and runtime inputs in `railway.toml`. Changes only
to tests, browser configuration, CI, or documentation do not trigger a web
service deployment. The previous successful deployment remains available for
rollback; do not delete it as part of a normal release.

## VPS

Use Docker with a reverse proxy such as Caddy or nginx. Terminate TLS at the proxy, forward the original host/protocol headers, and keep the Node process private.

```yaml
services:
  web:
    image: milkandhenny:latest
    restart: unless-stopped
    env_file: .env.production
    ports:
      - "127.0.0.1:3000:3000"
```

The web process runs the Postgres-leased daily maintenance job after database migrations.

## Cutover and rollback

1. Deploy on a temporary hostname.
2. Verify `/api/health`, `/health`, authentication, images, uploads, transfers, and admin reads.
3. Add both apex and `www` custom domains to the new host.
4. Apply the exact DNS verification and routing records returned by the host.
5. Verify TLS and canonical redirects.
6. Keep the previous deployment untouched during the observation window.
7. Roll back by restoring the old DNS records if a critical flow fails.

Do not delete the previous project or rotate shared credentials until the new deployment is stable.
