# Postgres and object-storage implementation plan

Status: implementation in progress; M1 inventory is underway. Production migration has not started.

Created: 2026-09-26.

## 1. Objective and agreed scope

Make Postgres authoritative for application records, transactions, authentication state, durable
work, and shared room state. Keep media binaries in S3-compatible object storage (currently R2).
Remove Redis from the required application runtime. Improve existing Postgres schemas wherever
the audit establishes a concrete integrity, ownership, recovery, or query-design benefit.

Deliver the complete application change: schema, repositories, workflows, browser/API
compatibility, admin and CLI tools, workers, notifications, data migration, deployment setup,
backups, documentation, verification, production cutover, and retirement of the old dependency.

The user selected a **planned maintenance window**. Preserve product behavior, public identifiers,
URLs, valid access, invalidations, original expiry, pending work, and recoverable room state.
Preserve offline/browser recovery contracts. Existing event-scoring quarantine remains in force.

This document records the agreed plan. Implementing it, obtaining production inventory,
and executing its operational steps must follow the active task's authorization. Pushing,
merging, deploying, production cutover, and service deletion require authorization. Planning
completion is not implementation completion.

### Working rules

- Follow [AGENTS.md](./AGENTS.md), the pinned toolchain in [package.json](./package.json), and the
  runtime in [Dockerfile](./Dockerfile).
- Make coherent local commits at completed implementation milestones; include only task-owned
  changes. Preserve unrelated work, including the pre-existing Dockerfile modification observed
  when this plan was created.
- Update the milestone ledger and checkpoint below with commits, verification, findings, and
  next action. Do not mark a gate complete using source inspection alone when it requires a
  running system, production data, or a restore drill.
- Record schema decisions in this document or linked implementation artifacts. Keep actual
  runtime documentation accurate during transition; identify target behavior as planned until
  implemented.
- Use no subagents unless explicitly requested. Do not introduce dependencies, infrastructure,
  or product behavior merely to make the migration more general.

## 2. Evidence and discovery boundaries

Repository inspection established the current storage families below. It did not establish a
complete production snapshot, row/key counts, PostgreSQL server configuration, provider backup
coverage, available connection budget, or a measured workload envelope. M1 must establish those
facts before finalizing physical DDL and cutover timing.

Relevant contracts:

- [Architecture](./docs/architecture.md)
- [Durable work](./docs/durable-work.md)
- [Effect lifecycle](./docs/effect-lifecycle.md)
- [Media pipeline](./docs/media-pipeline.md)
- [Media worker](./docs/media-worker.md)
- [Operations](./docs/operations.md)
- [Disaster recovery](./docs/disaster-recovery.md)
- [Room-first multiplayer](./docs/room-first-multiplayer.md)
- [Multiplayer verification](./docs/multiplayer-testing.md)
- [CLI parity](./.cursor/rules/cli-parity.mdc)

Current implementation entry points:

| Area                          | Existing files                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database and migration runner | [Postgres](./lib/platform/postgres.server.ts), [migrations](./lib/platform/migrations.server.ts)                                                                                                                                                                                                                                |
| Words and shares              | [store](./features/words/store.server.ts), [types](./features/words/content-types.ts), [shares](./features/words/share.server.ts), [image metadata](./features/words/image.server.ts)                                                                                                                                           |
| Albums                        | [album repository](./features/media/album-repository.server.ts)                                                                                                                                                                                                                                                                 |
| Transfers                     | [records](./features/transfers/store.server.ts), [reservations](./features/transfers/upload-reservation.server.ts), [queue](./features/transfers/media-queue.server.ts), [reconciliation](./features/transfers/media-reconcile.server.ts)                                                                                       |
| Worker and updates            | [worker runtime](./features/system/media-worker-runtime.server.ts), [status](./features/transfers/media-worker-status.server.ts), [events](./features/transfers/media-events.server.ts)                                                                                                                                         |
| Authentication                | [attendee sessions](./features/attendee-access/session.server.ts), [token sessions](./features/auth/internal/token-session.server.ts), [CLI authentication](./features/auth/cli-auth.server.ts), [passkey ceremonies](./features/attendee-access/passkeys.server.ts), [upload windows](./features/auth/upload-access.server.ts) |
| Small shared state            | [rate limits](./lib/platform/rate-limit.server.ts), [reports](./features/reports/report-store.server.ts), [Best Dressed](./features/best-dressed/best-dressed.server.ts)                                                                                                                                                        |
| Multiplayer                   | [backplane](./features/things/shared/multiplayer-realtime-backplane.server.ts), [paired engine](./features/things/remote/paired-game-room-engine.server.ts), [result outbox](./features/game-results/outbox.server.ts)                                                                                                          |
| Pool and presentations        | [pool credentials](./features/things/pool/pool-redis.server.ts), [presentation state](./features/things/pitches/presentation.server.ts)                                                                                                                                                                                         |

M1 must follow indirect adapter users, Lua scripts, CLI commands, operational scripts, browser
recovery stores, and object prefixes as well as direct Redis imports. Inspect the fully migrated
database schema; early CREATE TABLE statements do not describe every later constraint or type.

## 3. Target ownership

| State                                                          | Authoritative home        | Required treatment                                         |
| -------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| Word metadata and Markdown                                     | Postgres                  | Atomic content/metadata save; preserve visibility and URLs |
| Word shares and PIN/revocation state                           | Postgres                  | Preserve links, hashes, invalidation timestamps, expiry    |
| Albums, photo order, covers, captions and focal metadata       | Postgres                  | Import editable R2 manifests                               |
| Media catalogue and derivative metadata                        | Postgres                  | Import image manifests; reference existing objects         |
| Original images, audio, video and downloadable files           | Private object storage    | Preserve keys; track lifecycle and ownership               |
| Approved public derivatives                                    | Public object storage/CDN | Generated from an explicit publication generation          |
| Transfers, groups, files and upload reservations               | Postgres                  | Transactional ownership and capacity rules                 |
| Media jobs, leases, retries and processing outcomes            | Postgres                  | Durable enqueue beside the causing change                  |
| Sessions, challenges, revocations, rate limits                 | Postgres                  | Atomic security rules and explicit expiry                  |
| Rooms, accepted actions, credentials and results               | Postgres                  | Versioned state, transactions, idempotent recovery         |
| Pitch presentation rooms and game-pool recovery credentials    | Postgres                  | Extend existing feature relationships                      |
| Reports, deduplication receipts and Best Dressed               | Postgres                  | Preserve totals, retention and one-time semantics          |
| Existing relational domains                                    | Existing Postgres tables  | Audit and improve; retain valid domain models              |
| Socket handles, disposable motion and rebuildable caches       | Process memory            | Bounded lifetime; reconnect/rebuild safely                 |
| Offline commands, local drafts and preferences                 | Browser storage           | Preserve reconciliation and ownership semantics            |
| Code, bundled decks, static assets, PWA manifests and fixtures | Git/build output          | Preserve existing source ownership                         |

An editable album/image manifest becomes database records. An offline scanner manifest, public
delivery manifest, RSS feed, sitemap, or export is a derived representation with a defined source.
An optional R2 delivery manifest must never become a second mutable authority.

Keep the current web and separate media-worker roles initially. Additional web replicas are a
verification scenario, not an automatic production topology change.

## 4. Schema design contract

### 4.1 Rules applying to every domain

For each affected table, M1/M2 must record exact columns, types, nullability, defaults, keys,
checks, indexes, deletion behavior, retention, principal queries, and source-to-target mappings.
The table families below are the target design, not executable DDL or proof that those names are
unused. Resolve naming against the actual schema and update this document before implementation.

- Follow existing internal ID conventions and verified server capabilities. Preserve opaque
  public IDs and existing relationships through explicit mapping where types differ.
- Keep stable identity separate from mutable display names and slugs. Add alias/history handling
  where an existing rename contract requires it; do not break inbound URLs.
- Use concrete foreign keys. Enforce same-event, same-transfer, and same-album relationships with
  composite constraints or an explicitly justified transactional invariant.
- Use timestamptz and absolute expiry. Define when transaction time versus wall-clock database
  time applies to lease operations. A cleanup delay cannot extend access.
- Put frequently queried fields in columns. Use bounded, validated, schema-versioned JSONB for
  cohesive documents and game aggregates. Avoid generic key/value replicas of Redis.
- Use revisions for optimistic edits and row locks for contended domain transitions. Specify a
  consistent lock order across multi-row operations.
- Hash high-entropy verification-only credentials. Preserve existing secure PIN/code hash formats.
  Encrypt recoverable secrets with a key identifier when an existing recovery API must return them.
- Define active, expired, revoked, deleted, and archived separately. Choose cascade, restrict,
  nullification, anonymization, and retention per relationship.
- Define the authoritative source of every stored counter/projection and how to reconcile it.
- Avoid long transactions around network, object storage, email, payment, or CPU-heavy processing.

### 4.2 Words, albums and media

| Table family              | Required fields and invariants                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `words`                   | Internal ID, unique existing slug, type, title/subtitle, Markdown, visibility, tags, featured flag, image reference, original timestamps, reading-time metadata, revision |
| `word_revisions`          | Word FK, revision, immutable saved content/metadata snapshot, timestamp; unique word/revision; documented retention                                                       |
| `word_share_links`        | Existing link identity, word FK, unique token hash, PIN hash and invalidation timestamp, expiry, revocation, creator                                                      |
| `albums`                  | ID, unique slug, title, date, description, publication state/generation, revision, cover relationship                                                                     |
| `album_photos`            | Album FK, preserved photo identity, asset FK, order, title/alt/caption, capture time, focal/preset settings; cover must belong to its album                               |
| `media_assets`            | Stable logical identity, source properties, lifecycle state and processing generation; no implicit permission grant                                                       |
| `media_objects`           | Asset FK, bucket/scope, key, object role, format, dimensions, size, integrity metadata where available, generation; unique bucket/key                                     |
| `word_media_links`        | Explicit word-to-asset use and existing embedded reference mapping                                                                                                        |
| `media_object_operations` | Durable publication/copy/deletion intent, target generation, idempotency identity, claim/lease, attempts, error and outcome                                               |

The current editable Markdown body moves from R2 into Postgres. Current state and its revision
snapshot save together; published revision pointers are introduced only where the existing
publication workflow requires them. Preserve public, unlisted and private behavior exactly.

Model asset identity, physical objects, and feature use separately. Authorization comes from the
owning feature and the requested representation. Review sharing between public/private uses;
do not deduplicate across access boundaries merely because bytes match. Preserve existing
`pitch_assets` and document identities while adding catalogue relationships where useful.

Publication prepares and verifies objects before activating the corresponding generation.
Unpublication stops application access/listing first, then performs tracked public-object removal.
Public-cache invalidation follows current policy; already downloaded copies cannot be recalled.
Deletion of one use cannot delete a still-referenced asset. Garbage collection must account for
concurrent attachment, in-flight jobs, published generations, retained revisions, and backups.

Keep existing media keys/URLs during import. Inventory externally consumed Markdown/manifests
before retiring old objects; retain intentional generated compatibility exports when required.
All GET/read paths must be audited for existing repair/deletion side effects during cutover.

### 4.3 Transfers and processing

| Table family                   | Required fields and invariants                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `transfers`                    | Preserved public identity, title, owner, expiry, deletion credential, revision, timestamps                                                   |
| `transfer_files`               | Transfer FK, preserved file ID/name, asset relationship, original and converted properties, source route, processing generation/status/error |
| `transfer_groups`              | Transfer FK, preserved group ID, live-photo/RAW-pair type, capture time                                                                      |
| `transfer_group_members`       | Group/file relationships and roles; both belong to the same transfer                                                                         |
| `transfer_upload_reservations` | Existing identity, actor, file fingerprint, reserved count/bytes, expiry and finalization receipt                                            |
| `media_jobs`                   | Concrete source relationship, operation/generation, status, availability, attempts, claim token/owner/expiry, error and completion           |
| `worker_instances`             | Instance/deployment/role identity, heartbeat, progress, active-work summary                                                                  |

Job identity is source + operation + generation. Retry preserves identity; explicit reprocessing
advances generation. Preserve existing conversion routes, error classifications, metadata,
delivery history, and permanent-failure behavior.

Lock transfer capacity while accepting reservations/finalizing files. Include outstanding
reservations in quotas. Enforce filename/file identity rules and group membership without whole
collection rewrites. Expiry/deletion cancels pending publication; a late worker cannot resurrect
the transfer. Preserve deletion/resume capabilities, using encryption if a legitimate API must
reissue a secret rather than merely verify it.

### 4.4 Authentication and expiring state

| Table family                           | Required responsibility                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Attendee sessions                      | Hashed opaque lookup, person/security version, authentication method/assurance, pending MFA context, rotation and expiry |
| Session grants/selections              | Ticket authority versions, selected event participant, existing scoped access semantics                                  |
| Person security versions               | Preserve current version/null/legacy behavior and person-wide revocation                                                 |
| Role token versions                    | Preserve admin/upload JWT version invalidation                                                                           |
| Token session registry and revocations | JTI, principal/role, timestamps, expiry, revocation and operational history                                              |
| CLI requests/codes/receipts            | PKCE, redirect/state binding, parent session, approval and atomic one-time exchange                                      |
| Passkey ceremonies                     | Bound challenge, purpose, person/session context, expiry, consumption                                                    |
| Upload access windows/audit            | Active-window identity, credential, allowed duration, expiry, historical actions                                         |
| Rate-limit buckets                     | Policy, privacy-preserving subject key, window, count and expiry                                                         |

Retain existing Postgres passkeys, TOTP credentials, recovery codes, email-login challenges,
permission grants and attendee action links. Avoid duplicate identities or credential stores.
Preserve signing secrets, cookie compatibility, outstanding valid handshakes, current assurance
requirements, role versions, denied JTIs and PIN invalidations during ordinary migration.

Consume a one-time credential atomically with the protected consequence. Scope idempotency by
operation/principal, store the request fingerprint and reusable outcome, and reject conflicting
input. Preserve current rate-window behavior and combined subject/global admission rules; lock
multiple buckets deterministically. Keep edge request protection and bounded application input
so abusive traffic cannot turn the database limiter into an unlimited workload.

### 4.5 Reports and voting

- Reports: typed identity, type, subject, severity, status and retention columns; bounded JSONB
  diagnostics; explicit staff/user notes; submission and duplicate-detection receipts. Record
  notification work in the same transaction. Preserve fingerprint privacy and retention rules.
- Best Dressed: rounds/windows, candidate totals, voter receipts, one-time vote tokens and access
  codes. Unique round/voter receipt; vote/code consumption and accepted increment are atomic.
- Import Best Dressed totals as a baseline and surviving voter receipts as duplicate protection.
  Only post-cutover ballots add to that baseline. Never fabricate missing historical ballots or
  add surviving imported receipts to totals a second time. Preserve clear/reset semantics.
- Keep existing Postgres polls and votes as their own domain.

### 4.6 Rooms, presentations and game results

| Table family                     | Required responsibility                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Game rooms                       | Stable identity, kind, schema version, revision, expiry, typed authoritative aggregate       |
| Room credentials                 | Principal/role binding, verification/recovery material, authority version, expiry/revocation |
| Room action receipts             | Scoped command identity, input fingerprint and accepted outcome/revision                     |
| Paired/remote-specific records   | Ordered command journal, decisions, sequence and connection ownership epochs                 |
| Game-result outbox               | Versioned result, payload hash, stable uniqueness, delivery/retention state                  |
| Presentation records             | Room/deck relationships, selected slide, revision, host/controller permissions, expiry       |
| Existing pool records/extensions | Assignment and room recovery credentials with existing retry receipts                        |

Keep cohesive game aggregates in typed JSONB where their reducer requires atomic state. Separate
independently accessed journals/credentials. Assign each membership/authority field one canonical
home; assemble reducer input at the repository boundary rather than maintain competing copies.

An action locks the room, validates expiry/authority/deduplication, runs the pure transition, and
commits state + receipt + result outbox together. Preserve injected clock/random/ID semantics.
Do not perform network effects under the room lock. Result identity includes its revision and
payload hash. Retention or room deletion must not silently discard undelivered durable results.

Cover Centre, Draw Country, Family Feud, Hot and Cold, Liars, Remote/paired, Same Brain, Spelling
Party, Twin, Pitch presentations and game-pool workflows. Preserve currently local-only games.
Do not reopen retired score tools or enable an inactive result consumer as a migration side effect.

### 4.7 Existing Postgres schema improvements

Audit all existing domains: people/identifiers/participants; events/tickets/checkouts/inventory;
assignments/transfers/returns/refunds/exchanges/credits; staff/scanner/checkpoint access; pitches;
communications/consent/email delivery; surveys/polls; reports/alerts/operations; game pools/results;
achievements; scheduling; retained scoring/history and offline reconciliation.

For each candidate improvement, record evidence, affected data, exact invariant, compatibility,
backfill, validation, expected query benefit and disposition. Apply justified improvements as
bounded domain changes; a valid existing design needs no cosmetic replacement.

Required audit topics:

1. Canonical identity and explicit purchaser/holder/participant/contact roles; merge history.
2. Orphans, mismatched event ownership, missing foreign keys and ambiguous deletion behavior.
3. Authority-bearing polymorphic targets, including action links, and enforceable target binding.
4. Money in minor units, currency consistency, refund/credit limits and allocation relationships.
   Normalize meaningful array-position relationships into rows where evidence warrants it.
   Cross-row financial invariants require transactions/locks or a suitable trigger, not a CHECK
   pretending to validate an aggregate. Preserve external provider idempotency and reconciliation.
5. Status/timestamp combinations, uniqueness of active relationships, conflict-safe transitions.
6. Scoped idempotency keys, request fingerprints, original outcomes and retention windows.
7. Source-of-truth versus cached totals/projections, with repair and audit procedures.
8. JSONB fields that need columns/FKs versus cohesive documents that should remain JSONB.
9. Pagination, indexes, duplicate indexes, row-lock contention and expensive collection reads.
10. Expiry, sensitive-data retention, immutable history, archival and restore behavior.

Validate existing rows before tightening constraints. Report and resolve contradictions explicitly;
do not delete records merely to make a constraint succeed. Large index/constraint changes need an
appropriate online or maintenance strategy, separate from the runner's ordinary transactions.

## 5. Runtime, transactions and notifications

### Durable job execution

1. Commit product change and specialized job/outbox row in one transaction.
2. Send an advisory wake after commit; wake failure cannot undo accepted work.
3. Claim available jobs with a short transaction using row locking and SKIP LOCKED.
4. Execute object/network/CPU work outside that transaction.
5. Complete only while holding the matching current claim token and source generation.
6. Reconcile expired leases, transient retries, terminal failures and unreferenced outputs.

Use generation/attempt-specific output keys so a stale worker cannot overwrite the winning
object before its database completion is rejected. Delivery is at least once; domain effects
must be idempotent. A lease does not guarantee exactly-once execution.

Retain specialized email, media and result APIs. Extend the existing Events, Media, Multiplayer
and Pitches runtimes. Do not introduce a generic queue API or a runtime per folder.

### Realtime

- Use a dedicated session-affine Postgres listener per participating process, shared under the
  established lifecycle. Do not allocate a connection per browser/room or put LISTEN through
  transaction pooling.
- Durable-change notifications contain small identifiers/revisions, never credentials, private
  answers or personal payloads. Resolve authorized state through feature workflows.
- Subscribe and commit LISTEN before refreshing initial state. On reconnect, resubscribe and
  refresh active subscriptions. Notifications may be missing, duplicated or stale.
- Keep browser WebSocket/SSE contracts. Provide bounded worker fallback scans and active-client
  reconciliation; define maximum recovery delay numerically in M1/M8.
- Disposable motion/presence stays in memory with bounded/coalesced cross-process notifications
  where needed. Persist connection epochs/presence leases only when they affect authority.
- Revalidate permissions on protected actions and within a documented bounded stream authority
  lease. Lost revocation notifications cannot leak protected updates indefinitely. Database
  outage must fail closed for protected operations/streams.
- Measure notification rate, listener reconnects and notification queue pressure. Dedicated
  listeners never hold long transactions. Load testing gates Postgres transient fan-out; a
  future transport change requires measured evidence and does not relocate durable room truth.

Primary references: [queue claims](https://www.postgresql.org/docs/18/sql-select.html),
[LISTEN startup ordering](https://www.postgresql.org/docs/18/sql-listen.html),
[NOTIFY semantics and limits](https://www.postgresql.org/docs/18/sql-notify.html).

### Database and operational resource limits

Budget query pools and listener connections across web, worker, maintenance, migrations and
rolling-deployment overlap. Use separate least-privilege runtime and migration roles; adding
Postgres to the media worker does not grant access to credentials or finance tables.

Audit the query helper's per-query SET/query/RESET round trips and choose a safe timeout policy
without leaking session settings between borrowers. Batch related reads, avoid N+1 content
queries, replace whole-collection scans with indexed work queries, and coalesce wakes/polls.
Measure row churn, cleanup batches, autovacuum and index growth for sessions, rates, jobs and
rooms. Partitioning is conditional on demonstrated volume and retention needs.

Report liveness, dependency reachability and progress separately. Track ready/leased/failed jobs,
oldest ready age, lease recovery, publication/deletion backlog, query latency, lock wait, pool
pressure, instance heartbeats and listener state. Idle queues are healthy without recent work.
Differentiate empty results from unavailable persistence in admin and health endpoints.

## 6. Migration design and maintenance runbook

### 6.1 Inventory and export

Produce a versioned source manifest with namespace/type, source count, destination, transformation,
expiry policy, ownership, sensitivity and validation rule. Include all independently stored
records, not only secondary-index membership. Unknown key families block cutover.

Capture source values and TTL consistently and convert to original absolute expiry. Deduplicate
SCAN results, handle supported serialization formats explicitly, and distinguish absent, expired,
malformed and inaccessible records. Export referenced Markdown/manifests and object metadata.
Record integrity hashes; do not treat multipart ETags as universal content checksums.

Export archives must be encrypted, checksummed and stored outside Git. Reports contain counts,
identifiers as safely appropriate, hashes and errors, not raw credentials or personal content.
Restore source access or obtain a verified backup if Redis is unreadable. Missing metadata/body
records require evidence and resolution; never infer publication or permission from orphan blobs.

### 6.2 Import and rehearsal

Use explicit administrative tooling with dry-run validation and resumable phases. Add migration
run/item records or an equivalent auditable manifest with stable source identity, content hash,
target identity, phase, timestamp and outcome. Reruns accept identical input and reject conflicts.
Validate archive integrity and input bounds before mutation.

Import in dependency order: existing-identity mappings, media catalogue, content, access state,
transfers/reservations, rooms/credentials, durable work and final derived views. Preserve opaque
IDs, ordering, timestamps, expiry, hashes, revocations and deduplication history. Do not overwrite
unrelated current Postgres records. Rebuild indexes/caches rather than import their inconsistencies.

Use isolated database and object targets for rehearsals, disable real payment/email side effects,
and test re-entry after each interrupted import phase. Synthetic cases exercise edge conditions;
a securely handled representative production snapshot establishes migration duration and parity.
Read-only comparisons are allowed before cutover; normal operation must not independently write
the same product state to Redis and Postgres.

### 6.3 Production preflight

Before scheduling cutover, record:

- Authorized deployment/release identifiers, operators, maintenance duration and abort criteria.
- Verified source accessibility; final export command/version and expected counts.
- Database backup, object coverage, restore evidence and independent archive location.
- Exact writer-stop procedure for web, rooms, workers, scheduler, cron and operational CLI.
- Existing presigned uploads and their reservation/finalization policy.
- Payment/provider webhook intake and durable acknowledgment/retry policy.
- Installed schema version, compatibility window, credentials, connection budget and probes.
- Acceptance script, reconciliation thresholds, observation period and rollback decision points.

Exact commands must be implemented and verified during M10/M11 before this becomes an executable
runbook. Do not substitute guessed provider commands or undocumented environment switches.

### 6.4 Cutover sequence

1. Verify backup/readability, current deployment state and source inventory; record cutover ID.
2. Put affected traffic in maintenance. Freeze every legacy writer, including read endpoints
   with mutation side effects; prevent old scheduled processes from restarting writes.
3. Drain workers within the window or terminate safely and record recoverable interrupted jobs.
   Preserve unfinished intents and delivery attempts; old claims are not live ownership.
4. Continue provider webhooks through a narrow durable intake path with processing paused, or
   use verified provider retries. Never acknowledge an event that was not durably recorded.
5. Allow already issued upload URLs to land only under existing scope; prevent conflicting
   finalization. Preserve original reservations/expiry and inventory late-arriving objects.
6. Capture the final consistent source export and object manifest after the writer barrier.
7. Import additively into the new tables and reconcile source/target totals and references.
8. Start the new app/worker with public access restricted. Test via purpose-created canary data
   and isolated side effects; track any mutations that affect the rollback boundary.
9. Confirm content, access/revocation, transfer/reservation recovery, room recovery, durable
   delivery, backlog and resource metrics. Abort on unresolved integrity or permission errors.
10. Reopen traffic. Resume scheduling and side-effect consumers deliberately; reconcile queued
    provider events and uploads. Verify no legacy process continues writing.
11. Observe for the predefined window. Record the release, comparisons, incidents and disposition.

### 6.5 Preservation policy

| Preserve                                                           | Rebuild or retire under an explicit rule                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| Content, metadata, visibility, publication state, media references | Derived caches, database indexes, regenerable manifests    |
| Original IDs, URLs, order, timestamps                              | Legacy Redis collection indexes                            |
| Valid sessions/shares/handshakes and original expiry               | Already expired challenges and credentials                 |
| Revocations, role/person versions, PIN invalidations               | Legacy distributed-lock ownership                          |
| Reservations, files, queued/failed work and retry history          | Dead socket connections and disposable cursor state        |
| Rooms, recovery credentials, accepted commands/results             | Old worker heartbeat records                               |
| Voting totals/receipts, reports and deduplication state            | Proven unreferenced temporary outputs after reconciliation |

Importing a TTL must not grant a fresh lifetime. Backfill missing data only from verified sources.
Dead-letter work is retained for inspection, not silently retried with a reset budget. New job
claims are established after cutover and fenced against the current generation.

### 6.6 Rollback and recovery

Before new authoritative mutations or external effects, resume the old application only after
verifying its source is still valid and no canary/reconciliation changes created divergence.

After accepting new authoritative writes, do not switch back to the frozen Redis snapshot.
Use a known compatible application revision that understands the Postgres schema, or repair
forward. Prepare and test that compatible fallback before release. Returning to Redis would need
a separately implemented and rehearsed reverse migration, which this plan does not assume.

Retain the final source export through the recorded acceptance/retention interval. Delete the
old service only under M13 authorization. Redact/expire sensitive archives under the agreed
retention policy; leaving them indefinitely is not a recovery strategy.

Disaster restore is different from planned migration: restoring an older database can resurrect
revoked credentials. Specify a trusted revocation checkpoint or deliberate session/security-version
invalidation on disaster recovery. Coordinate Postgres and object generations. Define transfer
recovery coverage explicitly; moving metadata to Postgres does not back up excluded transfer blobs.

## 7. Milestones and dependency order

The default sequence is M0 through M13. Domain implementation can overlap only when its listed
dependencies are complete and work ownership is explicit. M12 and M13 remain operational gates.

| Milestone                                           | Dependencies                             | Status                             |
| --------------------------------------------------- | ---------------------------------------- | ---------------------------------- |
| M0 — durable plan                                   | User architecture decisions              | Complete: this document            |
| M1 — inventory and physical schema specification    | M0                                       | In progress; source export pending |
| M2 — database foundation and migration safety       | M1                                       | Pending                            |
| M3 — existing relational integrity improvements     | M1, M2                                   | Pending                            |
| M4 — identity, rates, reports and voting            | M2, relevant M3 changes                  | Pending                            |
| M5 — words, albums and media catalogue              | M2, relevant M3 changes                  | Pending                            |
| M6 — transfers and media execution                  | M4, M5                                   | Pending                            |
| M7 — rooms, presentations and game results          | M2, M4, relevant M3 changes              | Pending                            |
| M8 — application and realtime integration           | M3–M7                                    | Pending                            |
| M9 — operations, recovery and documentation         | M8                                       | Pending                            |
| M10 — complete migration tooling and rehearsal      | M3–M9                                    | Pending                            |
| M11 — release qualification and cutover readiness   | M10                                      | Pending                            |
| M12 — authorized production cutover and observation | M11, deployment authorization            | Pending                            |
| M13 — retirement and final acceptance               | M12, retention and removal authorization | Pending                            |

### M1 — Inventory and physical schema specification

Evidence ledger: [production and source inventory](./docs/postgres-migration-inventory.md).

- [x] Capture the effective production Postgres schema, migration ledger, server limits and
      top-level object-storage counts without reading private content.
- [x] Identify the production migration-ledger mismatch and missing scheduled database backup
      coverage as explicit blockers.
- [x] Checksum-validate and fully decode the user's RDB export, including all 224 keys, value types
      and absolute expiry. Exact source capture time remains unproven; its download time is known.
- [ ] Reconcile the export against a fresh source snapshot at cutover and classify the legacy
      `guest:*` and `user-report:*` keys. Upstash command-limit errors still prevent a live read.

- [ ] Enumerate direct/indirect storage users, all key families, object prefixes, tables,
      mutations, read models, scheduled work and browser recovery contracts.
- [x] Match the exported word and transfer object references to R2; parse and validate editable
      album/word-image manifests and their referenced objects without exposing private content.
- [ ] Obtain permitted production inventory and effective schema; verify server features,
      backup coverage, storage sizes, key/row counts and data-quality contradictions.
- [ ] Specify complete DDL, relationships, indexes, retention and source mappings for each
      target family; record improve/retain decisions for every existing domain.
- [ ] Record action/API/cookie/URL/CLI compatibility and exact idempotency/concurrency invariants.
- [ ] Establish baseline latency, concurrent rooms/participants, media throughput and idle
      load; choose numerical peak/headroom targets, fallback delays and resource budgets.
- [ ] Define rollback compatibility and exact release/observation/retirement acceptance criteria.

Exit: no unknown source family or undefined ownership; concrete physical schema and migration
mapping are reviewable. Production-dependent facts remain visible blockers if unavailable.

### M2 — Database foundation and migration safety

- [ ] Extend transaction helpers, timeout policy, cancellation and lifecycle as justified.
- [ ] Implement additive migrations using the ordered runner and locking; organize new files
      without rewriting applied history. Add checksums with a verified legacy baseline and a
      defined failure mode for unexpected historical drift.
- [ ] Separate schema installation from unprivileged worker startup; define connection/role grants.
- [ ] Implement dedicated listener/reconnect lifecycle and advisory publication primitives.
- [ ] Implement bounded expiry/cleanup and lease primitives consumed by real feature workflows.
- [ ] Verify clean database creation, upgrade from current schema, failed migration recovery,
      concurrent startup, pool-setting isolation and least-privilege access.

Exit: migration and runtime foundations work against real Postgres; no feature depends on an
unimplemented compatibility assumption. Commit source, tests and updated contracts together.

### M3 — Existing relational integrity improvements

- [ ] Implement the approved identity, ownership, action-target and relationship changes.
- [ ] Apply justified money/allocation, active-record uniqueness and state consistency changes.
- [ ] Backfill/validate before tightening constraints; record contradictory-data resolution.
- [ ] Update affected workflows, queries, CLI/browser contracts and migration mappings.
- [ ] Verify concurrent issuance/refund/transfer/credit operations, duplicates, merges and
      retained historical data for each changed domain; preserve scoring quarantine.

Exit: every inventory candidate has an implemented improvement or evidenced retain/defer
decision. A deferral affecting an agreed integrity requirement blocks release.

### M4 — Identity, rates, reports and voting

- [ ] Move attendee/JWT session authority, versions, revocations, ceremonies and CLI handshakes.
- [ ] Move upload windows, login deduplication and all feature rate-limit users.
- [ ] Implement report storage/receipts and transactional notification work.
- [ ] Implement Best Dressed totals, receipts, codes and reset behavior.
- [ ] Add domain importers with legacy-version, expiry, one-time race and baseline-vote fixtures.
- [ ] Verify cookies, step-up/MFA, parent-session binding, PKCE, admin session management,
      revocation and disabled/expired access, plus admin/CLI parity.

Exit: imported valid credentials work; invalid credentials stay invalid; parallel attempts cannot
double-consume a credential, vote, report submission or protected quota.

### M5 — Words, albums and media catalogue

- [ ] Implement content, revisions, shares, albums/photos and media relationships.
- [ ] Import R2 Markdown and editable manifests, including responsive image metadata.
- [ ] Implement publication/object-operation intents, reference-safe deletion and reconciliation.
- [ ] Update editor, public loaders/listings, images, RSS/sitemaps, audits and CLI workflows.
- [ ] Preserve Markdown bytes/semantics, dates, image refs, order, focal data, cover, privacy,
      share/PIN state and existing intentional URL contracts.
- [ ] Verify concurrent edits/reorders, interrupted publication/unpublication and shared-asset
      deletion; preserve current user-visible save/publish timing contracts.

Exit: Postgres owns editable content/catalogue state; R2 reads/writes serve binaries or explicit
derived exports. No read path silently repairs/deletes product state.

### M6 — Transfers and media execution

- [ ] Implement transfer/file/group/reservation tables and quota transactions.
- [ ] Implement atomic enqueue, indexed claims, renewals, fenced completion, retry/dead-letter,
      cancellation and explicit reprocessing under the Media runtime.
- [ ] Replace Redis reconcile/status/events dependencies and add per-instance health reporting.
- [ ] Give the worker scoped Postgres credentials, shutdown recovery and bounded processing.
- [ ] Import active transfers and queued/leased/failed work without losing attempt history.
- [ ] Test worker death before/after upload, stale completion, duplicate claims, reservation
      races, late uploads, RAW/live-photo groups and transfer expiry/deletion during processing.

Exit: no accepted upload loses its job; abandoned work recovers; a stale/expired operation cannot
publish or overwrite current output. Reconciliation uses indexed queries.

### M7 — Rooms, presentations and game results

- [ ] Implement repositories and domain mappings for every room engine listed in section 4.6.
- [ ] Preserve deterministic reducers, clocks, deduplication and command acknowledgments.
- [ ] Implement paired journals/epochs and pool recovery credentials with explicit relationships.
- [ ] Move presentation state and host/controller recovery.
- [ ] Commit official result envelopes with their causing transition; retain existing consumer
      activation policy and idempotency.
- [ ] Test simultaneous answers/buzzes, host/controller races, duplicate commands, refresh,
      reconnect, expiration, ejection, result revision conflicts and interrupted delivery.

Exit: every multiplayer mode and presentation recovers across process restart and multiple web
processes without lost accepted actions, secret leakage or changed game rules.

### M8 — Application and realtime integration

- [ ] Connect all browser WS/SSE consumers to the Postgres notification lifecycle.
- [ ] Implement snapshot reconciliation, lost-notification recovery, bounded presence fan-out
      and stream authorization expiry/revalidation.
- [ ] Remove remaining runtime Redis usage from routes, capability checks, admin, CLI, scheduler,
      maintenance, startup/shutdown and monitoring.
- [ ] Verify browser drafts, offline scanner/pitch/game command replay and old-client retries.
- [ ] Run two-web-process plus separate-worker tests, notification disconnect/failure tests,
      and the numerical workload/idle-load envelope from M1.
- [ ] Audit SQL round trips, pools, lock waits, notifications and cleanup churn; fix measured
      regressions and record the production capacity configuration.

Exit: the integrated app boots and completes its journeys with Redis absent; lost wakes affect
latency only within the agreed bound, and database outage does not grant protected access.

### M9 — Operations, recovery and documentation

- [ ] Update environment templates, deployment roles, probes, operational runner and alerts.
- [ ] Update database/word archive tooling and restore drills for new content ownership.
- [ ] Establish object/database consistency checks, retention and expired-auth restore policy.
- [ ] Update AGENTS, architecture, durable-work, Effect lifecycle, media pipeline/worker,
      operations, disaster recovery, development setup and impacted CLI documentation.
- [ ] Verify health distinctions, cleanup batches, quiet idle operation, alert deduplication,
      and a database-plus-object restore in isolation.

Exit: operational setup and recovery match the actual app; media metadata backup is not presented
as a guarantee for unprotected blobs. Record evidence against documented recovery targets.

### M10 — Complete migration tooling and rehearsal

- [ ] Complete namespace discovery, archive integrity, exact TTL handling and unknown-key refusal.
- [ ] Integrate all domain importers, stable mappings, dry-run validation and resume receipts.
- [ ] Reconcile counts, hashes, references, visibility, revocations, job identities, room receipts
      and voting baselines. Explain every excluded expired/corrupt item.
- [ ] Exercise every import-phase interruption, repeated import and conflicting-source case.
- [ ] Rehearse writer freeze, webhook intake, late uploads, canary verification and reopening.
- [ ] Measure real duration and finalize maintenance allowance, commands, abort criteria,
      compatible fallback release and observation/retention periods.

Exit: representative full migration and recovery rehearsal pass with no unexplained loss,
permission expansion, duplicate effects or unresolved source families.

### M11 — Release qualification and cutover readiness

- [ ] Re-run required integrated verification on the exact release commit/artifact.
- [ ] Run `pnpm verify:release`; review functional, concurrency, performance and recovery evidence.
- [ ] Verify schema/app compatibility, dependencies, roles, secret delivery and backup evidence.
- [ ] Finalize exact production runbook, release identifiers, acceptance script and fallback.
- [ ] Present the concrete release and runbook for deployment/cutover authorization.

Exit: release is technically ready; production execution waits only for required authorization
and any explicitly scheduled maintenance time. Do not equate this with production completion.

### M12 — Authorized production cutover and observation

- [ ] Execute and record section 6.4 against the authorized targets and artifact.
- [ ] Reconcile production source/target records and verify public/private user journeys.
- [ ] Confirm normal work completion, notification recovery, resource usage and maintenance runs.
- [ ] Observe for the M11-defined period, covering at least a scheduled cleanup execution and
      normal representative user/worker activity. Resolve actionable errors before sign-off.
- [ ] Record production evidence, exceptions, rollback disposition and remaining retirement work.

Exit: production operates on the new architecture and reconciles to the migration source, with
no unexplained data loss or violated access invariant.

### M13 — Retirement and final acceptance

- [ ] Remove obsolete runtime Redis code/dependencies/configuration and update lockfile/fixtures.
      Keep any needed import reader isolated from the runtime until archive obligations end.
- [ ] Verify no old writer, cron, dashboard or deployment still requires Redis.
- [ ] Confirm archive retention and restore readiness, then obtain required removal authorization
      and retire old service/credentials. Record completion without exposing secrets.
- [ ] Run affected checks after cleanup and finish documentation/checkpoint.
- [ ] Verify every requirement below; record final commits/releases and operational evidence.

Exit: no required Redis service or undocumented transitional authority remains.

## 8. Verification and final acceptance

Use narrow tests while iterating. Source milestones require `pnpm check` and the tests covering
changed behavior. Cross-feature changes require `pnpm test`. Run `pnpm build` for packaging,
dependencies, runtime or server/client boundary changes. Run focused Playwright journeys for
changed browser behavior. The release gate is `pnpm verify:release`. Record exact commands,
results, artifact/commit and why their coverage is sufficient; do not assume CI evidence exists.

Real Postgres integration tests are required for locking, constraints, notifications, one-time
consumption and claims. In-memory mocks cannot establish these guarantees. Use isolated object
targets for publication/deletion tests, and never send real user email/payment effects in drills.

- [ ] Every source namespace, table domain and editable manifest has a recorded disposition.
- [ ] Physical schema enforces the approved relationships and transaction invariants.
- [ ] Words, albums, metadata, visibility and referenced content reconcile by identity/hash.
- [ ] Existing public IDs, URLs, cookies, shares and CLI/API contracts remain compatible.
- [ ] Revoked/expired/consumed access remains invalid; valid access retains original lifetime.
- [ ] Transfer reservations, files/groups and all durable work are accounted for.
- [ ] Duplicate requests and repeated delivery do not create duplicate domain consequences.
- [ ] Interrupted/stale workers recover safely and cannot publish the wrong generation.
- [ ] All rooms/presentations recover; hidden information and permission boundaries hold.
- [ ] Best Dressed totals reconcile without fabricated/double-counted ballots; reports deduplicate.
- [ ] Existing relational features and scoring quarantine continue to satisfy their contracts.
- [ ] Offline and browser recovery state reconciles with the new server authority.
- [ ] Entire app and operational tooling work without Redis configuration.
- [ ] Lost notifications and reconnects meet measured recovery bounds across two web processes.
- [ ] Performance/resource targets, maintenance jobs, health and alerts pass on the release.
- [ ] Backup/restore, migration rehearsal, production cutover and observation have recorded evidence.
- [ ] Documentation, local commits, release identity and retirement records are complete.

## 9. Checkpoint and decision log

### Current checkpoint — 2026-09-26, M1 in progress

- Completed: M0 planning document; read-only M1 production Postgres schema and top-level R2
  inventory; full checksum/type decode of the supplied Upstash RDB export and a static
  Redis/browser key-family map in [the inventory](./docs/postgres-migration-inventory.md).
- Commits: planning `b982c582`; first production inventory `39481052`; Redis export and static
  recovery inventory `dfb0cee1`; R2 reference reconciliation `db0fbe9e`. Source implementation
  commits have not started.
- Key decisions: Postgres application authority; object storage for media; no required Redis;
  planned maintenance window; preserve behavior/identities/expiry; additive schema evolution;
  atomic specialized jobs; fenced outputs; advisory notifications; forward-compatible rollback.
- Relevant files: evidence map in section 2; this file is the implementation ledger.
- Verification: the first inventory commit passed `pnpm exec oxfmt --check` and local-link checks.
  The new RDB evidence passed the Upstash parser's CRC/type verification and strict database-0
  decode; its audit printed aggregate counts only. A read-only R2 listing and selected manifest
  downloads matched all 13 word bodies, all 64 active-transfer storage references, and all 14
  album originals/84 public variants/14 OG objects; three word image manifests and 18 variants
  also matched. The 47 relational pitch asset keys match all 47 private pitch objects. Seven
  candidate cross-event/deck relationship violations were counted and each returned zero.
  Documentation formatting, links and whitespace will be checked before this
  checkpoint's commit. Source/release tests remain pending.
- Findings: production runs Postgres 18.6 with 117 public tables and a 28 MB database. Its
  migration ledger has `0025_site_settings`, absent from the source list, while source has
  `0025_site_settings_v2`. PITR is disabled, no backup schedule is listed, and the only listed
  backup is from 2026-08-23. Private and public R2 prefixes were counted without reading objects.
  The export has 224 keys, including 192 attendee sessions and eight raw, unleased media jobs in
  `transfer:media:processing`. Seven jobs reference the one exported transfer; one references a
- missing transfer; this is also the one job whose source object is absent from R2. The
  original `guest:list` contains 274 top-level guests and 157 plus-ones; one legacy report and
  its index remain. The token-session index has 190 stale entries and the current report index
  has two.
- Unresolved: exact Redis snapshot time/fresh cutover delta; legacy guest-list retention/import
  decision; public pitch publication references and backup coverage; measured load/resource
  budgets; physical DDL; migration duration; operational command/credential setup; restore drill;
  quantified acceptance and observation/retention periods.
- Next action: finish effective relational-schema audit and migration-ledger baseline, then
  specify physical DDL/source mapping. Do not start production migration from the table sketches
  in this document.

### Milestone checkpoint template

For each completed milestone append: date, milestone, commit(s), decisions/DDL changes, affected
files, source/target mapping changes, checks and evidence, remaining risks/blockers, and next
action. When a new finding changes a dependency or acceptance criterion, update the main plan
and ledger as well as the checkpoint.
