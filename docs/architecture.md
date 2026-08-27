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

## Cross-feature composition

Feature modules do not call one another in both directions. Cross-feature read models and workflows live at a neutral composition edge:

```text
events ───────┐
tickets ──────┼─> event-operations ─> routes / server functions
scoring ──────┘

games ─> game-results durable outbox ─> explicit scoring consumer
```

`features/event-operations` composes event and ticket page data without making either feature own the other. Games publish versioned official-result envelopes to `features/game-results`; they do not import scoring or install process-global callbacks. Redis persists each result beside the authoritative game mutation, while local and cross-replica signals only wake an explicit consumer. Delivery is therefore retryable and scoring can be disabled without changing game rules.

Event scoring keeps stable public boundaries while splitting implementation by responsibility. The admin route dispatches to focused configuration, ledger, discovery, staffing, identity, and media handlers. Its persistence barrel delegates to aggregate-specific repositories for settings and activities, participants and teams, ledger, pools and staff, identity, and history and media.

Authentication follows the same shape: `auth.server.ts` is a stable server-only boundary over separate token/session, authorization, verification, and rate-limit modules. Upload access remains its own capability rather than accumulating in the main authentication module.

Staff identity is explicit. Personal assignments link to an `event_people` record and retain their role preset; shared stations remain deliberately personless. Remembered, revocable staff and scanner access is available from the root navigation after refresh. Attendee score identity remains the event participant ID: canonical names are private identity data, generated aliases are the safe default, and a chosen public alias can change without moving scores or changing the person.

## Browser navigation and state

The URL owns durable, addressable resources. React state owns live interaction.
An in-place mode gets a browser-history entry only when Back should undo or
leave that mode. Local games use this rule for setup-to-round transitions:
`useGameScreenHistory` adds a same-URL history entry, while timers, scores,
drawings, and motion state remain in the game and tab-scoped recovery model.
Back returns to setup before a second Back leaves the tool. It does not make
the live round a shareable deep link.

Public content uses route paths, breadcrumbs, and contextual journey rails.
Things, games, the pitch studio, admin, health, and transactional surfaces own
their own product controls instead of receiving a forced global footer. The
full decision table and URL rules live in [navigation.md](./navigation.md).

## Effect subsystems

Effect v4 is used at service boundaries, not as a general programming style. Three subsystems use it today: multiplayer (`features/things/shared`), events/ticketing (`features/events`, `features/tickets`), and the Pitch Night studio (`features/things/pitches`).

The same boundary pattern is used by all three:

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
provider failures retry with backoff for at most 7 days or 10 attempts. Accepted and terminal rows
remove the outbox's message body and recipient-address copy, while a provider-neutral operations ledger keeps
masked purpose, source, entity references and delivery state for 120 days. Raw delivery events are
folded into that state and removed after 30 days. Bounce and complaint suppressions retain only the
recipient hash and a masked hint until reviewed.

## Media

R2 is currently the S3-compatible object store. `R2_PRIVATE_BUCKET` is the durable source of truth for album manifests, draft derivatives, originals, private words, pitch assets, and transfers. `R2_PUBLIC_BUCKET` contains only published album display derivatives, published social cards, and public editorial media delivered through `VITE_MEDIA_PUBLIC_URL`. The private bucket has no custom domain or `r2.dev` access. Protected reads use short-lived URLs after the application checks access. Browser uploads use presigned URLs, so large file bodies bypass the web service. Independent, single-bucket credentials prevent public-media code from reading private objects and private-media code from writing the public origin by mistake.

Album manifests are JSON objects in private R2. They are a storage format, not repository content. The admin panel and CLI call the same durable workflows. Upload finalisation keeps an album in draft. Publishing copies only AVIF, WebP, and social-card derivatives to the public bucket; unpublishing removes those public objects. Originals remain private and downloads are authorised against the published manifest.

Storage implementation details remain behind `lib/platform/r2.server.ts`; the application host does not need to be Cloudflare.

## Media processing

Images and GIFs are processed on the request that finalises the upload. RAW and video are queued, because they cost seconds of CPU and can pull gigabytes off object storage:

```text
web request -> Redis queue -> media worker drain -> R2 derivatives -> Redis pub/sub -> SSE to the viewer
```

Before transfer uploads, a browser worker capability-checks still images. HEIF and other
browser-decodable formats that the server cannot accept directly are normalised, while oversized
stills are downscaled to a bounded working copy using `ImageDecoder` or `createImageBitmap` plus
`OffscreenCanvas`. The source file remains an exact, separately archived original for transfers.
Album and words uploads may send the bounded copy because their server-generated derivatives are
the product artifact. Sharp remains the authoritative validation, metadata, orientation, and
responsive-output boundary; browser preparation is an upload optimisation, not trusted processing.

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
