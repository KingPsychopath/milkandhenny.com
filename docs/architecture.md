# Architecture

## Shape

Milk & Henny is a provider-neutral modular monolith packaged as one Node artifact. The normal
deployment has one web process; heavy media processing may run the same artifact as a separate
worker role.

```text
Browser
  -> TanStack Start / Nitro Node server
       -> feature workflows
            -> Postgres adapter (relational state, outboxes, leases)
            -> Redis adapters (sessions, rooms, transfers, queues, realtime)
            -> S3-compatible storage adapter (private sources and public media)
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

Effect v4 owns asynchronous orchestration and process lifecycle where cancellation, deadlines,
bounded concurrency, retry policy, scoped resources, or typed infrastructure failure justify it. It
is not a general replacement for ordinary TypeScript.

Events/ticketing and Pitch Night retain the established service-wrapper pattern. Multiplayer moves
the boundary inward because game commands need deterministic replay:

```text
TanStack / Nitro boundary
  -> ManagedRuntime (one per independently owned subsystem lifecycle)
       -> Effect workflow
            -> clock, randomness, ID and persistence services
            -> pure game transition
            -> atomic room + official-result outbox commit
            -> advisory wake publication
            -> typed failures, timeout, logging, spans and metrics
```

Multiplayer game rules receive an explicit `{ now, randomValues, newId }` context. They never obtain
time, randomness or identifiers themselves. Redis, locks, outbox persistence, wake publication and
telemetry remain in server-only Effect workflows. Infrastructure adapters may retain plain async
implementations behind those services; the state transition itself stays ordinary TypeScript and
returns state plus domain events. Effect remains behind `.server.ts` boundaries; browser contracts,
React, offline games, reducers, and reconciliation hooks do not import its runtime. Promise
conversion happens only at TanStack/Nitro edges.

The runtime ownership map is deliberately small:

| Runtime     | Responsibilities                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Events      | Events, tickets, attendee operations, waitlists, icebreaker persistence, scoring, realtime, communications, and app scheduling |
| Media       | Media-worker lifecycle, private transfers, album and word orchestration, and bounded media maintenance                         |
| Multiplayer | Shared room and game-pool workflows, best-dressed voting, realtime resources, and command execution                            |
| Pitches     | Pitch Night server workflows and presentation lifecycle                                                                        |

Services compose into the owning runtime Layer. A feature service or compatibility facade does not
create another `ManagedRuntime` or shutdown plugin. Score rules, eligibility, balance calculations,
ticket/refund policy, validation, and repositories remain ordinary TypeScript. Runtime layers own
execution concerns such as durable-outbox draining, advisory wake consumption, deadlines, bounded
delivery, scheduled fibers, spans, cancellation, finalizers, and shutdown.

Postgres, Redis, R2, email, and Stripe adapters remain plain async implementations. Workflows use an
injectable service only where substitution, cancellation, lifecycle, or typed failure handling
provides a real boundary. Provider context is scoped to the active Effect operation so existing
plain ticket, refund, media, and realtime engines use the Layer-selected implementation without
turning individual SDK and query calls into pipelines.

Effect is pinned exactly in `package.json`; a prerelease version bump is coordinated rather than
routine. The complete adoption, resource, cancellation, failure, retry, testing, and shutdown
contract is [effect-lifecycle.md](./effect-lifecycle.md).

## Multiplayer runtime

Multiplayer is the largest Effect subsystem:

```text
TanStack / Nitro boundary
  -> one process-wide ManagedRuntime
       -> game-owned Effect workflow
            -> Redis or development-memory room store
            -> game-owned pure command transition
            -> atomic room + durable outbox commit
            -> advisory wake publication
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

The runtime model does not imply that every participant should connect a device. Each co-located
mode declares its own device topology and attention profile under the canonical
[room-first multiplayer design standard](./room-first-multiplayer.md). Shared infrastructure may
provide presenter synchronization, host pairing, private snapshots, readiness, reconnection, and
official results; the game engine still owns the phase rhythm, rules, teams, secrets, score,
correction policy, inactive-player role, and social fun premise. A personal device needs a game
reason—private information, simultaneous input, identity, team control, or accessibility—not merely
an available room primitive.

A completed game publishes a neutral result such as participants or teams, raw score, placement,
winner, and match ID. Event participation points, eligibility, rewards, claims, and reversals belong
to the event layer and cannot be required for the match to finish. This keeps room play usable
without forcing every person to scan in and prevents event policy from becoming game truth.

Shared-room games with simultaneous starts compose the multiplayer readiness policy. Players join ready, may opt out while the lobby is open, and receive a persisted, rate-limited start request when a host tries to begin. Starting with unready players requires a second explicit action naming those players; the game engine rechecks the same players atomically before removing them. Solo games and paired-device authority flows do not use lobby readiness.

The runtime is built lazily once per Node process and disposed by a Nitro shutdown hook. It owns services, Redis pub/sub connections, metrics, timeouts, and scoped cleanup. It never owns authoritative room state or a permanent fiber per room. Redis remains the distributed source of truth, so another replica can serve the next request.

Wake publication is safe to retry because it is advisory and idempotent. Room creation and state mutations are not retried generically; their atomicity and idempotency remain explicit in the game engine. Party Room serializes mutations with a bounded Redis lease, while Paired Game commands use action IDs and atomic Redis claims.

### Multiplayer development harnesses

Every synchronized game must be operable by one tester through the contract in
[multiplayer-testing.md](./multiplayer-testing.md). A shared development shell may own virtual
device frames, viewport presets, bots, time/failure controls, capture storage, scenario selection,
pop-outs, and audit exports. Each game supplies an adapter that creates valid rooms, lists its real
roles and production surfaces, defines deterministic scenarios and legal bot actions, and
captures/restores its own authoritative state.

The harness does not create a second game engine and does not hand omniscient state to production
role components. Presenter, host, team, and player panels receive the same credentials and redacted
projections they receive on separate devices. Privileged inspection remains visibly separate. Dev
routes and scenario mutation boundaries fail closed outside development/test; `noindex` alone is
not an access boundary.

## Persistence

Three durable systems are split by responsibility.

**Postgres** (`DATABASE_URL`) holds relational product state: events, tickets, redemptions,
checkouts, scoring ledgers and projections, attendee operations, communications/outboxes, Pitch
Night documents, scheduler leases, and their audit records. It owns workflows that require
transactions, relational constraints, or durable queryable history. Examples include:

- A refund marks the ticket refunded and returns its seat in one transaction, or does neither.
- Capacity is a `count(*)` of live ticket rows taken under `select ... for update` on the ticket type, so two buyers racing for the last seat serialise. There is no separate counter that can drift from the rows it describes.
- Single admission is `update tickets set redeemed_at = now() where id = $1 and redeemed_at is null returning *`. The second scanner gets zero rows.
- `tickets` references `ticket_types` with `on delete restrict`, so deleting an event that sold tickets fails loudly instead of orphaning receipts.

Migrations are an append-only list in `lib/platform/migrations.server.ts`, applied on boot under an advisory lock so several replicas can start together. A migration failure is logged and surfaced on `/health` rather than killing the process — the rest of the site keeps serving.

**Redis** (`REDIS_REST_*`) holds expiring or coordination-heavy state: authentication sessions,
rate limits, multiplayer rooms, advisory wake fan-out, transfer metadata, word metadata and share
records, distributed locks, and the leased media queue. Mutable independently read records use one
key each. Specialized queues, indexes, and aggregate-adjacent outboxes document why they require an
atomic structure.

**R2** holds blobs. The private bucket owns incoming uploads, private/source media, pitch assets,
album manifests, and transfer files. The public bucket contains only intentionally published
derivatives and editorial media.

The production app fails closed when required persistence is unavailable. In-memory fallbacks are limited to explicit development scenarios; database-backed tests run against a real Postgres and skip when none is reachable.

**One key per record** remains the rule for anything still in Redis. A single-key collection plus a re-rendering poll loop is what caused [the guest-list KV read spike](./postmortem-guestlist-kv-read-spike.md).

Hot & Cold stores one immutable, word-free completion summary per browser run
in Postgres. Numbered daily routes can therefore show privacy-thresholded
community distributions without exposing guesses or answers. Signed-in game
history remains a separate person-owned read model; anonymous community runs
never create account records. Community summaries contain real completed runs
only and remain hidden until the privacy threshold is met.

### Game judging revisions

Games with deterministic judging or scoring assets own an independent semantic
version. This is deliberately not the application package version: an app
release can leave judging untouched, and different games can revise their rules
independently.

- Major revisions change word identity, ranks, scoring, or another boundary that
  makes results incomparable.
- Minor revisions change official hints or another player-visible ruling while
  preserving the comparable core score.
- Patch revisions change metadata or implementation without intentionally
  changing a ruling.

The exact revision travels with generated assets, authoritative room state,
browser recovery, history, and community results. Revisions coexist in durable
storage. Revision-addressed assets keep a historical daily on its original
ruling, while the browser recovery path can discover saves from any earlier
revision and replay their raw guesses against the revision selected for that
puzzle. CI compares immutable judging assets with the base revision and rejects
asset changes without a version increase. Games that have no comparable
generated or server-side rulings do not need this machinery.

Hot and Cold also has a rolling editorial release gate. Every generated target
must have a complete deterministic rank permutation, target at rank zero, three
progressively closer safe hints, and matching review evidence. The next 30
unplayed daily targets additionally require a small human trail: expected close
words, comparison regressions, approved hints, and only failure-specific
forbidden hints. Approval stores a hash of the exact top-30 trail and hint set,
so regeneration automatically requires review again. The admin games view shows
those trails, changes from the previous revision, suspicious rare or polysemous
words, and comparison failures. The records remain source-controlled rather
than mutable production data.

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

Every object-storage operation selects `public` or `private` explicitly; unknown namespaces never fall through to the public origin. Browser upload workflows share one transport for exact signed headers, cancellation, timeouts, and retry policy, while feature services continue to own authorisation, limits, key reservation, final verification, and publication. All word and album uploads land in the private bucket under lifecycle-managed `incoming/` prefixes. Feature finalisation verifies and promotes them, copying only intentional public results to the public bucket, so abandoned or partially completed uploads are never public assets.

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

Product-time workflows are scheduled by the web application after database migrations finish. A
Postgres lease per job makes this safe across deploy overlap, restarts, and multiple replicas; a
stale lease is recoverable after a crashed process. The central scheduler owns communication
fan-out, email retry wake-ups, scheduled scoring transitions, official-result recovery, Pitch
reminders, and operations digests.

Cleanup workflows remain authenticated HTTP use cases. `ops/run-maintenance.mjs` calls them
sequentially, emits structured results, and exits non-zero on failure. Railway's daily maintenance
service is an independent housekeeping and recovery backstop, not the clock for user-visible
product behavior.

## Health

- `/api/health` performs bounded live checks for required capabilities, exposes only safe runtime
  metadata, and returns 503 when the process should not receive traffic.
- `/health` renders the safe capability model for humans.
- `/api/debug` is admin-protected and performs deeper Redis, object-storage, database, email-outbox,
  and runtime probes.
- `/api/debug` also exposes per-replica multiplayer operations, failures, reconciliation latency, socket termination, rate-limit, lock-contention, and realtime-backplane metrics.

Required capability failures produce an unhealthy readiness response. Missing optional maintenance or worker configuration is visible without taking the core site offline.

## Deployment invariants

- The server listens on `$HOST` and `$PORT`.
- Public `VITE_*` values are present at build time.
- Secrets are supplied at runtime and never enter the client bundle.
- The container filesystem is ephemeral; durable product mutations belong in Postgres, Redis, or
  object storage. Git contains source and build inputs, not runtime product writes.
- `/api/health` must pass before traffic cutover.
- The previous deployment remains available until post-cutover verification completes.
