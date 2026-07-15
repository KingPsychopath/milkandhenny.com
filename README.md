# milk & henny

A portable TanStack Start application for writing, photo galleries, party tools, and private file transfers.

The web application is a standard Node server. It does not require Vercel, Railway, or any other specific host and can run from the included Docker image on a managed platform or VPS.

## Runtime architecture

| Responsibility         | Owner                                                      |
| ---------------------- | ---------------------------------------------------------- |
| SSR, routes, API, auth | TanStack Start + Nitro Node server                         |
| Application state      | Redis-compatible REST API                                  |
| Images and files       | S3-compatible object storage (currently Cloudflare R2)     |
| Public media delivery  | Configured CDN/custom-domain origin                        |
| Scheduled cleanup      | Any scheduler calling the authenticated maintenance runner |
| RAW/video derivatives  | Optional dedicated worker; disabled by default             |

The application is a modular monolith. UI routes collect intent, server functions and API routes enforce transport/auth boundaries, feature modules own workflows, and `lib/platform` contains external adapters.

## Requirements

- Node.js 22+
- pnpm 9.15.4
- Redis REST credentials
- S3-compatible object-storage credentials

## Local development

```bash
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`.

Useful commands:

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
pnpm start
pnpm cli
```

The project uses TypeScript 7's native preview (`tsgo`), Oxlint, and Oxfmt. ESLint and Prettier are intentionally not part of the toolchain.

## Environment contract

Copy [`.env.example`](./.env.example). The minimum production variables are:

```dotenv
VITE_BASE_URL=https://milkandhenny.com
VITE_MEDIA_PUBLIC_URL=https://pics.milkandhenny.com

REDIS_REST_URL=
REDIS_REST_TOKEN=

R2_ACCOUNT_ID=
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_PUBLIC_BUCKET=milkandhenny-public
R2_PRIVATE_BUCKET=milkandhenny-private

AUTH_SECRET=
ADMIN_PASSWORD=
STAFF_PIN=
UPLOAD_PIN=
CRON_SECRET=

MEDIA_PROCESSOR_MODE=local
VITE_TRANSFER_MEDIA_BROWSER_PREP=auto
```

Only `VITE_*` variables enter the browser bundle. Never prefix credentials or authentication secrets with `VITE_`.

`REDIS_REST_*` is the canonical provider-neutral Redis contract. Legacy `KV_REST_API_*` and `UPSTASH_REDIS_REST_*` names remain temporary rollback aliases during the migration.

## Health and capabilities

- `/api/health` — cheap machine-readable readiness check; no dependency operations.
- `/health` — safe human-readable capability page.
- `/api/debug` — admin-protected deep Redis/object-storage probes.

The capability page distinguishes required services from optional functions. Advanced RAW/video processing is expected to show as disabled while `MEDIA_PROCESSOR_MODE=local`.

## Docker or VPS

Build-time public values must be supplied while creating the image:

```bash
docker build \
  --build-arg VITE_BASE_URL=https://milkandhenny.com \
  --build-arg VITE_MEDIA_PUBLIC_URL=https://pics.milkandhenny.com \
  -t milkandhenny .
```

Run with the remaining variables supplied through an env file or secret manager:

```bash
docker run --env-file .env.local -p 3000:3000 milkandhenny
```

The image runs as an unprivileged user, listens on `$PORT`, and includes a Docker health check.

## Railway

`railway.toml` selects the same Dockerfile and `/api/health` endpoint used everywhere else. Railway is deployment configuration only; application code does not import Railway APIs.

Deployment sequence:

1. Create a Railway project and web service.
2. Add the production variables from `.env.example`.
3. Deploy the repository or current directory.
4. Verify the temporary Railway domain and `/health`.
5. Add the custom domains and update DNS.
6. Keep the previous deployment available briefly for rollback.

## Scheduled maintenance

`pnpm maintenance` calls all authenticated cleanup routes. It requires `APP_BASE_URL` (or `VITE_BASE_URL`) and `CRON_SECRET`.

Run it from Railway Cron, system cron, GitHub Actions, or any scheduler:

```cron
15 3 * * * cd /srv/milkandhenny && pnpm maintenance
```

## Optional media worker

The core site, ordinary image uploads, galleries, and transfers do not require a dedicated worker. RAW previews and video derivatives do.

Keep this disabled initially:

```dotenv
MEDIA_PROCESSOR_MODE=local
```

When a dedicated worker is deployed, configure `TRANSFER_MEDIA_WAKE_URL`, `TRANSFER_MEDIA_WAKE_TOKEN`, a direct `REDIS_URL`, and change the mode to `hybrid` or `worker`.

## Documentation

See [`docs/README.md`](./docs/README.md) for architecture, security, media, operations, and deployment notes.
