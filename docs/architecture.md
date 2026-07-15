# Architecture

## Shape

Milk & Henny is a provider-neutral modular monolith deployed as one Node service.

```text
Browser
  -> TanStack Start / Nitro Node server
       -> feature workflows
            -> Redis REST adapter
            -> S3-compatible storage adapter
            -> optional media-worker wake adapter
  -> public media origin (direct images and downloads)
```

The host supplies a port and environment variables. Railway, Docker Compose, Kubernetes, and a plain VPS all run the same `.output/server/index.mjs` artifact.

## Ownership

| Layer                       | Responsibility                                                      |
| --------------------------- | ------------------------------------------------------------------- |
| `src/routes`                | Routing, transport validation, response shape, coarse authorization |
| `features/*/*.functions.ts` | TanStack server-function boundaries                                 |
| `features/*/*.server.ts`    | Feature workflows and durable product rules                         |
| `features/*/ui`             | User interaction and rendering                                      |
| `lib/platform`              | Redis, object storage, logging, HTTP/provider translation           |
| `lib/shared`                | Environment-safe shared constants and pure utilities                |
| `ops`                       | Deployment-independent operational entry points                     |
| `deploy`                    | Optional independently deployed workloads                           |

Routes do not own business truth. Workers may execute feature workflows but must not redefine eligibility or state transitions.

## Persistence

Redis stores mutable application state: guest check-ins, voting, transfer metadata, authentication sessions, rate limits, word metadata, and share records. `REDIS_REST_URL` and `REDIS_REST_TOKEN` are the canonical application contract.

The production app fails closed when required persistence is unavailable. In-memory fallbacks are limited to explicit development/test scenarios.

## Media

R2 is currently the S3-compatible object store. `R2_PUBLIC_BUCKET` contains albums and editorial media and is delivered through `VITE_MEDIA_PUBLIC_URL`. `R2_PRIVATE_BUCKET` contains transfers, has no public domain or `r2.dev` access, and is read only through short-lived URLs issued after the application validates the transfer capability ID. Browser uploads use presigned URLs, so large file bodies bypass the web service.

Storage implementation details remain behind `lib/platform/r2.server.ts`; the application host does not need to be Cloudflare.

## Media processing

`MEDIA_PROCESSOR_MODE=local` is the safe default. It keeps the dedicated queue consumer disabled and avoids jobs accumulating for a worker that does not exist.

The optional worker boundary exists for sustained RAW/video processing:

```text
web request -> Redis queue -> authenticated wake endpoint -> worker drain -> R2 derivatives
```

Enable it only when the worker is deployed, observable, and supplied with direct Redis plus storage credentials.

## Maintenance

Cleanup workflows remain authenticated HTTP use cases. `ops/run-maintenance.mjs` calls them sequentially, emits structured results, and exits non-zero on failure. Any scheduler can execute it; scheduling is not embedded in application code.

## Health

- `/api/health` performs configuration-only readiness checks and is safe for frequent polling.
- `/health` renders the same safe capability model for humans.
- `/api/debug` is admin-protected and performs live Redis/object-storage probes.

Required capability failures produce an unhealthy readiness response. Missing optional maintenance or worker configuration is visible without taking the core site offline.

## Deployment invariants

- The server listens on `$HOST` and `$PORT`.
- Public `VITE_*` values are present at build time.
- Secrets are supplied at runtime and never enter the client bundle.
- The container filesystem is ephemeral; durable mutations belong in Redis, object storage, or git.
- `/api/health` must pass before traffic cutover.
- The previous deployment remains available until post-cutover verification completes.
