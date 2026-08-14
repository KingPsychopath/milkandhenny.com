# Architecture

## Shape

Milk & Henny is a provider-neutral modular monolith deployed as one Node service.

```text
Browser
  -> TanStack Start / Nitro Node server
       -> feature workflows
            -> Postgres adapter (events, tickets)
            -> Redis REST adapter (sessions, rate limits, rooms)
            -> S3-compatible storage adapter
            -> email and payments adapters
            -> optional media-worker wake adapter
  -> public media origin (direct images and downloads)
```

The host supplies a port and environment variables. Railway, Docker Compose, Kubernetes, and a plain VPS all run the same `.output/server/index.mjs` artifact.

## Ownership

| Layer                       | Responsibility                                                                  |
| --------------------------- | ------------------------------------------------------------------------------- |
| `src/routes`                | Routing, transport validation, response shape, coarse authorization             |
| `features/*/*.functions.ts` | TanStack server-function boundaries                                             |
| `features/*/*.server.ts`    | Feature workflows and durable product rules                                     |
| `features/*/ui`             | User interaction and rendering                                                  |
| `lib/platform`              | Postgres, Redis, object storage, email, payments, logging, provider translation |
| `lib/shared`                | Environment-safe shared constants and pure utilities                            |
| `ops`                       | Deployment-independent operational entry points                                 |
| `deploy`                    | Optional independently deployed workloads                                       |

Routes do not own business truth. Workers may execute feature workflows but must not redefine eligibility or state transitions.

## Effect subsystems

Effect v4 is used at service boundaries, not as a general programming style. Three subsystems use it today: multiplayer (`features/things/shared`), events/ticketing (`features/events`, `features/tickets`), and the Pitch Night studio (`features/things/pitches`).

The shared shape is the same in both:

```text
TanStack / Nitro boundary
  -> ManagedRuntime (one per subsystem, disposed by a Nitro close hook)
       -> Context.Service wrapping plain async engine functions
            -> timeout, Data.TaggedError failures, structured logs, spans
```

Engine functions stay ordinary `async` code in `*.server.ts` and own the product rules. The service layer owns how those calls behave operationally. Effect remains behind `.server.ts` boundaries; browser contracts, React, offline games, reducers, and reconciliation hooks do not import its runtime. Promise conversion happens only at TanStack/Nitro edges.

Effect is pinned to an exact v4 beta version while v4 is prerelease, so a version bump is a coordinated change rather than a routine upgrade.

## Multiplayer runtime

Multiplayer is the larger of the two Effect subsystems:

```text
TanStack / Nitro boundary
  -> one process-wide ManagedRuntime
       -> game-owned Effect service
            -> game-owned domain engine and policy
                 -> Redis or development-memory adapter
       -> bounded telemetry
       -> optional Redis realtime backplane
```

The paired-game and party-room profiles own their state transitions, authorization rules, Redis keys, contracts, and browser reconciliation. Shared multiplayer code owns only repeatable capabilities: runtime lifecycle, room credentials, validation primitives, wake transport, backpressure, telemetry, and cross-replica fan-out.

```text
PairedGameRoom                 PartyRoom
  local game authority          server game authority
  player + judge roles          presenter + player membership
  snapshot reconciliation       authoritative state transitions
  command journal               action idempotency
  device leases                 distributed mutation lock
          \                       /
           shared room primitives
           shared wake transport
           shared runtime + telemetry
```

`PairedGameRoom` names the reusable two-device authority model used by remote judging. `PartyRoom` stays scoped to the `spelling-party` feature and does not pretend to be a universal party-game abstraction. New room models compose the shared capabilities they require instead of inheriting from one generic room class.

Shared-room games with simultaneous starts compose the multiplayer readiness policy. Players join ready, may opt out while the lobby is open, and receive a persisted, rate-limited start request when a host tries to begin. Starting with unready players requires a second explicit action naming those players; the game engine rechecks the same players atomically before removing them. Solo games and paired-device authority flows do not use lobby readiness.

The runtime is built lazily once per Node process and disposed by a Nitro shutdown hook. It owns services, Redis pub/sub connections, metrics, timeouts, and scoped cleanup. It never owns authoritative room state or a permanent fiber per room. Redis remains the distributed source of truth, so another replica can serve the next request.

Wake publication is safe to retry because it is advisory and idempotent. Room creation and state mutations are not retried generically; their atomicity and idempotency remain explicit in the game engine. Party Room serializes mutations with a bounded Redis lease, while Paired Game commands use action IDs and atomic Redis claims.

## Persistence

Two stores, split by what each is good at.

**Postgres** (`DATABASE_URL`) holds events, ticket types, tickets, redemptions and checkout sessions. These moved off Redis because they need guarantees Redis cannot give without hand-rolling them:

- A refund marks the ticket refunded and returns its seat in one transaction, or does neither.
- Capacity is a `count(*)` of live ticket rows taken under `select ... for update` on the ticket type, so two buyers racing for the last seat serialise. There is no separate counter that can drift from the rows it describes.
- Single admission is `update tickets set redeemed_at = now() where id = $1 and redeemed_at is null returning *`. The second scanner gets zero rows.
- `tickets` references `ticket_types` with `on delete restrict`, so deleting an event that sold tickets fails loudly instead of orphaning receipts.

Migrations are an append-only list in `lib/platform/migrations.server.ts`, applied on boot under an advisory lock so several replicas can start together. A migration failure is logged and surfaced on `/health` rather than killing the process — the rest of the site keeps serving.

**Redis** (`REDIS_REST_*`) keeps what suits it: authentication sessions, rate limits, multiplayer room state, wake fan-out, transfer metadata, word metadata and share records.

The production app fails closed when required persistence is unavailable. In-memory fallbacks are limited to explicit development scenarios; database-backed tests run against a real Postgres and skip when none is reachable.

**One key per record** remains the rule for anything still in Redis. A single-key collection plus a re-rendering poll loop is what caused [the guest-list KV read spike](./postmortem-guestlist-kv-read-spike.md).

Transactional email uses a Postgres outbox. Product workflows add idempotent messages, the web
process drains them in bounded batches, and daily maintenance is an independent backstop. Temporary
provider failures retry with backoff. Accepted and permanently failed rows keep delivery metadata
but remove the message body and recipient address.

## Media

R2 is currently the S3-compatible object store. `R2_PUBLIC_BUCKET` contains albums and editorial media and is delivered through `VITE_MEDIA_PUBLIC_URL`. `R2_PRIVATE_BUCKET` contains transfers, has no public domain or `r2.dev` access, and is read only through short-lived URLs issued after the application validates the transfer capability ID. Browser uploads use presigned URLs, so large file bodies bypass the web service.

Storage implementation details remain behind `lib/platform/r2.server.ts`; the application host does not need to be Cloudflare.

## Media processing

Images and GIFs are processed on the request that finalises the upload. RAW and video are queued, because they cost seconds of CPU and can pull gigabytes off object storage:

```text
web request -> Redis queue -> media worker drain -> R2 derivatives -> Redis pub/sub -> SSE to the viewer
```

The worker is the same server image with `MEDIA_WORKER_ROLE=worker`; there is no separate worker build to drift. `MEDIA_PROCESSOR_MODE=local` processes everything inline and disables the queue — the right default, and the right setting whenever no worker is running, since a queue with no consumer just accumulates.

See [media-worker.md](./media-worker.md).

## Maintenance

Cleanup workflows remain authenticated HTTP use cases. `ops/run-maintenance.mjs` calls them sequentially, emits structured results, and exits non-zero on failure. Any scheduler can execute it; scheduling is not embedded in application code.

## Health

- `/api/health` performs configuration-only readiness checks and is safe for frequent polling.
- `/health` renders the same safe capability model for humans.
- `/api/debug` is admin-protected and performs live Redis/object-storage probes.
- `/api/debug` also exposes per-replica multiplayer operations, failures, reconciliation latency, socket termination, rate-limit, lock-contention, and realtime-backplane metrics.

Required capability failures produce an unhealthy readiness response. Missing optional maintenance or worker configuration is visible without taking the core site offline.

## Deployment invariants

- The server listens on `$HOST` and `$PORT`.
- Public `VITE_*` values are present at build time.
- Secrets are supplied at runtime and never enter the client bundle.
- The container filesystem is ephemeral; durable mutations belong in Redis, object storage, or git.
- `/api/health` must pass before traffic cutover.
- The previous deployment remains available until post-cutover verification completes.
