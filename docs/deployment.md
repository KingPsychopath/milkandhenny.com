# Deployment

## Portable artifact

The root `Dockerfile` is the production contract. It builds TanStack Start with Nitro's Node preset and copies only `.output` plus operational scripts into an unprivileged runtime image.

Public browser configuration is supplied as Docker build arguments:

```text
VITE_BASE_URL
VITE_MEDIA_PUBLIC_URL
VITE_TRANSFER_MEDIA_BROWSER_PREP
VITE_MULTI_FILE_ZIP_URL
VITE_MULTI_FILE_ZIP_MODE
```

All credentials remain runtime variables.

## Railway

`railway.toml` selects the Dockerfile, `/api/health`, and an on-failure restart policy. Start with one replica, 512 MB–1 GB memory, 0.5–1 vCPU, and no persistent volume.

The canonical production origin is `https://milkandhenny.com`. Cloudflare redirects
`www` to the apex host while preserving the path and query string.

The `maintenance` service uses `ops/` as its Railway root directory. Its
`ops/railway.toml` builds the small maintenance image and schedules it for
`03:15 UTC` daily.

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

Schedule `node ops/run-maintenance.mjs` daily with the same `APP_BASE_URL` and `CRON_SECRET`.

## Cutover and rollback

1. Deploy on a temporary hostname.
2. Verify `/api/health`, `/health`, authentication, images, uploads, transfers, and admin reads.
3. Add both apex and `www` custom domains to the new host.
4. Apply the exact DNS verification and routing records returned by the host.
5. Verify TLS and canonical redirects.
6. Keep the previous deployment untouched during the observation window.
7. Roll back by restoring the old DNS records if a critical flow fails.

Do not delete the previous project or rotate shared credentials until the new deployment is stable.
