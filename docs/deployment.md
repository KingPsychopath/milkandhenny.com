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

## Credentials

Every secret the production web service, media worker and email-event relay Worker read is listed
here. Values live in Bitwarden, in the project's production collection, and in the runtime
that reads them; this table records names only. Each credential has one name, used for the
provider credential and its Bitwarden item, following
`<project>-<env>-<holder>-<purpose>-<access>`. A credential maps to one variable, or to the key pair
its provider issues together.

| Credential and Bitwarden item                     | Variable                                          | Stored in                                                                   | Scope                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `milkandhenny-prod-railway-email-send`            | `EMAIL_API_KEY`                                   | Railway `web`                                                               | Cloudflare API token, Email Sending send permission, one account                                                |
| `milkandhenny-prod-railway-r2-public-write`       | `R2_PUBLIC_ACCESS_KEY` / `R2_PUBLIC_SECRET_KEY`   | Railway `web` and `media-worker`                                            | Cloudflare R2 token, Object Read & Write, bucket `milkandhenny-pics` only                                       |
| `milkandhenny-prod-railway-r2-private-write`      | `R2_PRIVATE_ACCESS_KEY` / `R2_PRIVATE_SECRET_KEY` | Railway `web` and `media-worker`                                            | Cloudflare R2 token, Object Read & Write, bucket `milkandhenny-private` only                                    |
| `milkandhenny-prod-railway-database-write`        | `DATABASE_URL`                                    | Railway `web`                                                               | One database; target is the [`mah_app_runtime` role](./postgres-runtime-roles.md), currently the owner          |
| `milkandhenny-prod-railway-media-database-write`  | `DATABASE_URL`                                    | Railway `media-worker`                                                      | One database; a login granted only the [`mah_media_worker` role](./media-worker.md#postgres-worker-credentials) |
| `milkandhenny-prod-railway-stripe-checkout-write` | `STRIPE_SECRET_KEY`                               | Railway `web`, only while selling paid tickets                              | Stripe restricted key: write Checkout Sessions and Refunds, read PaymentIntents and Refunds                     |
| `milkandhenny-prod-railway-stripe-webhook-write`  | `STRIPE_WEBHOOK_SECRET`                           | Railway `web`, only while selling paid tickets                              | Signing secret of the one `/api/stripe/webhook` endpoint                                                        |
| `milkandhenny-prod-worker-email-events-write`     | `EMAIL_EVENT_SECRET`                              | Railway `web` and Cloudflare Worker `milkandhenny-email-event-relay` secret | Generated; authenticates the relay to `/api/email/events/cloudflare` only                                       |
| `milkandhenny-prod-railway-auth-signing-admin`    | `AUTH_SECRET`                                     | Railway `web`                                                               | Generated; signs every session and derives token-encryption keys                                                |
| `milkandhenny-prod-railway-admin-login-admin`     | `ADMIN_PASSWORD`                                  | Railway `web`                                                               | Generated; admin sign-in                                                                                        |
| `milkandhenny-prod-railway-upload-pin-write`      | `UPLOAD_PIN`                                      | Railway `web`                                                               | Generated; guest upload gate                                                                                    |
| `milkandhenny-prod-railway-cron-write`            | `CRON_SECRET`                                     | Railway `web`                                                               | Generated; manual maintenance routes only                                                                       |

`EMAIL_EVENT_SECRET` is one value held by two runtimes. It is named for the relay Worker, which
presents it; the web service only verifies it. Rotate it in both places together, following
[cloudflare-email-events.md](./cloudflare-email-events.md).

Production has no Redis connection variables. Once the web service uses its runtime role,
the Postgres owner URL stays only in the Railway `Postgres` service for migrations. Operator-run commands such as
the [guest archive importer](./legacy-guest-archive.md) and `pnpm event-scoring` receive their
values for that one command and are not runtime credentials.

When a provider credential or Bitwarden item does not match this table, rename it and this table
together. Rotation replaces the value and keeps the name.

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
