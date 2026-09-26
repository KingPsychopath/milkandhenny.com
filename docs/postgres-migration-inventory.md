# Postgres migration inventory

Status: M1 evidence in progress. Captured 2026-09-26. This is an inventory, not approval to run
the migration or executable target DDL. [The implementation plan](../plan.md) owns the gates.

## Production evidence

Read-only Railway production inspection found:

| Item                     | Observation                                                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Postgres                 | 18.6; `max_connections=500`; database size 28 MB                                                                                                                                                                                                                        |
| Effective schema         | 117 public tables; schema-only `pg_dump` captured outside Git at `/tmp/milkandhenny-prod-schema-20260926.sql`, SHA-256 `3dfa0733650f3f600f5c4404caf5e513e84ed608ef58f0ccf49a018f59ff3b63`                                                                               |
| Migration ledger         | 97 rows through `0095_intentional_survey_identity`; source list has 96 entries. Production alone records `0025_site_settings`, while source contains `0025_site_settings_v2`. This historical mismatch needs an explicit baseline policy before checksums are enforced. |
| Installed extensions     | `plpgsql` only                                                                                                                                                                                                                                                          |
| WAL and timeout settings | `wal_level=replica`; default `statement_timeout=0`; default `idle_in_transaction_session_timeout=0`                                                                                                                                                                     |
| Railway backup coverage  | PITR disabled; no scheduled backup; one listed backup created 2026-08-23, named `Pre-Security-Patch Backup`. No restore evidence established.                                                                                                                           |
| Table statistics         | `pg_stat_user_tables` snapshot held outside Git at `/tmp/milkandhenny-prod-tablestats-20260926.csv`. These are estimates, not reconciliation counts.                                                                                                                    |

Read-only R2 listing through the production web service credentials counted objects without
printing keys or contents:

| Scope / top-level prefix | Objects |         Bytes |
| ------------------------ | ------: | ------------: |
| Private `albums`         |     114 |   251,697,603 |
| Private `pitches`        |      47 |     9,062,374 |
| Private `transfers`      |     168 | 4,669,822,705 |
| Private `words`          |       6 |         7,746 |
| Public `albums`          |      98 |    14,600,827 |
| Public `pitches`         |      25 |       345,010 |
| Public `words`           |      32 |    12,200,329 |

Object counts are not proof of application references, backup coverage or content integrity.

## Relational audit snapshot

The effective schema dump contains 117 public tables, 163 explicit indexes and 204 foreign-key
constraints. Selected exact production counts (read-only queries, 2026-09-26) are:

| Table                   | Rows | Table                        | Rows |
| ----------------------- | ---: | ---------------------------- | ---: |
| `events`                |    3 | `tickets`                    |  119 |
| `event_people`          |   26 | `event_participants`         |  119 |
| `pitch_decks`           |   10 | `pitch_assets`               |   47 |
| `game_pool_runs`        |   10 | `game_pool_rooms`            |   64 |
| `official_game_results` |   12 | `application_scheduled_jobs` |    7 |
| `email_outbox`          |  908 | `score_transactions`         |   59 |

Seven targeted contradiction counts are all zero: parent ticket in another event, participant
ticket in another event, score-media link activity/participant/transaction in another event,
pitch deck thumbnail asset in another deck, and missing thumbnail asset. Current single-column
foreign keys permit several of these mismatches despite the clean data. Composite constraints
are M3 candidates after checking the affected write paths and all 117 tables' effective
relationships. The production `site_settings` shape matches the source
`0025_site_settings_v2` SQL, while the ledger contains both that ID and an extra historical
`0025_site_settings` ID. Treat the latter as an explicit legacy baseline entry; do not rewrite
the ledger or pretend to know the originally applied SQL checksum.

A second read-only listing and selected manifest reads reconciled the supplied RDB to object
storage without printing keys or private content:

| Reference family                                         |                Source references | Present | Finding                                                        |
| -------------------------------------------------------- | -------------------------------: | ------: | -------------------------------------------------------------- |
| Word Markdown body keys                                  |                               13 |      13 | Six private and seven public `content.md` objects              |
| Active transfer file storage keys                        |                               64 |      64 | All in the private bucket                                      |
| Media-processing job storage keys                        |                                8 |       7 | One missing private object; see orphan-job investigation below |
| Album manifests                                          |                                2 |       2 | Both parse, both published; 14 photos total                    |
| Album photo originals, public variants and OG references | 14 originals, 84 variants, 14 OG |     All | All referenced objects present                                 |
| Public word image manifests                              |                                3 |       3 | Three image entries; all originals and 18 variants present     |

There is only one distinct transfer prefix among the 168 private transfer objects. The one job
referencing a missing transfer is also the one whose source object is missing. A file may be
absent because its transfer expired; the import must use source expiry and ownership before
deciding whether to replay or discard it. All 47 `pitch_assets` rows match the 47 private pitch
objects exactly (42 images and five thumbnails). Public pitch publication objects and their
five thumbnail manifests have only been counted. Object backup/restore coverage remains
unverified.

## Upstash export received

The user supplied a fresh `guestlist-kv` RDB export on 2026-09-26. A copy with mode 0600 is held at
`tmp/private-migration/upstash-20260926.rdb` (repository-ignored); SHA-256
`9dbb17f1c44765ca74892bc00ba2eca46f2f2904f09c47768f184db8c0fc17c4`. The downloaded
file's modification time was 05:53:26 UTC; this is a download timestamp, not proof of the exact
source snapshot time. The export is RDB format 14. Redis 8.2/8.4 cannot load it. The
[Upstash RDB parser](https://github.com/upstash/rdb) at commit
`acce847ecb5c86b38602fec8ac2a2d11e3256f9f` passed full file checksum/type verification
and a strict database-0 read. The one-off auditor and parser checkout are outside Git under
`/tmp/milkandhenny-upstash-rdb-20260926`. It printed only aggregate counts, never values or
credential-bearing keys. No Redis function libraries were present in the export; Upstash states
that exports omit functions, so source code remains the authority for Lua behavior.

| Export family                      | Keys | Data and reconciliation finding                                                                                                            |
| ---------------------------------- | ---: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `event-scoring:attendee-session:*` |  192 | 192 strings with absolute expiry, 2026-10-24 through 2026-11-24 UTC                                                                        |
| `auth:sessions:index`              |    1 | Set of 190 IDs; all 190 referenced `auth:session:*` records are absent                                                                     |
| `auth:token-version:*`             |    3 | Persistent strings                                                                                                                         |
| `auth:upload-open`                 |    1 | Persistent list with four entries                                                                                                          |
| `words:meta:*`, `words:index`      |   14 | 13 metadata strings and 13 matching index members                                                                                          |
| `transfer:*`, `transfer:index`     |    2 | One expiring transfer record and one matching index member                                                                                 |
| `transfer:media:processing`        |    1 | Eight raw, unleased jobs; queue and dead-letter keys absent                                                                                |
| `transfer:media:worker-status`     |    1 | Four-field hash                                                                                                                            |
| `diagnostic-report:v1:*` and index |    4 | Three expiring records; five index members, two stale                                                                                      |
| `best-dressed:session` and votes   |    2 | Persistent strings                                                                                                                         |
| `guest:list` and `user-report:*`   |    3 | Original guest list with 274 guests and 157 nested plus-ones; one expiring legacy report record and its matching one-member expiring index |

All 224 keys were decoded; 199 have absolute expiry. None had expired by the file's download
time. This snapshot is evidence, not the final cutover delta: source writes and TTL expiry must be
reconciled again at the maintenance window. The eight processing items decode as valid raw jobs
with distinct idempotency keys, spanning two transfers. Seven point at the one exported transfer;
one points at a missing transfer. Do not replay the orphan without checking expiry and R2 object
ownership. Do not import the stale session/report index members as valid records. Git history
identifies `guest:list` as the original whole-list guest store (initial commit `b8d61e2b`);
current source has no reader. Commit `9f6dc320` identifies the two `user-report:*` keys as the
prior report format. Retain the guest list in the protected source archive while its privacy
and retention disposition is decided; retain/import the unexpired legacy report with its
original expiry if the target report schema can represent it.

The [Upstash export contract](https://upstash.com/docs/redis/howto/importexport) says Redis
Functions are excluded from RDB exports. The absence of a namespace in this snapshot also does
not remove its implementation requirement: an empty queue, room family or rate-limit family can
be populated by future traffic.

## Static Redis and browser contracts

The following source key families are mapped even when no key exists in the supplied export.
Values and original absolute expiry must be migrated per record; transient locks and advisory
channels have no durable row to copy.

| Owner                  | Source key families / contract                                                                                                                                                                                                                                                    | Target concern                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Words                  | `words:meta:*`, `words:index`, `words:share:*`, `words:share-index:*`, `words:share-slugs`, `words:share:pin-rl:*`, `words:meta:*:mutation-lock`                                                                                                                                  | Content, share/PIN/revocation rows and rate windows; replace mutation lock with row revision |
| Transfers              | `transfer:*`, `transfer:index`, `transfer:upload-reservation:*`, `transfer:media:{queue,processing,dead,idempotency:*,worker-status,reconcile-lock}` and event channel                                                                                                            | Transfer, reservation, job, lease and worker records; notifications advisory                 |
| Authentication         | `auth:token-version:*`, `auth:recent-login:*`, `auth:revoked-jti:*`, `auth:session:*`, `auth:sessions:index`, `auth:cli-{request,request-approved,code,code-claimed}:*`, `auth:upload-open`, `auth:upload-open:audit`                                                             | Scoped sessions, revocations, CLI challenges and upload access                               |
| Attendee access        | `event-scoring:attendee-session:*`, attendee lock/version keys, `attendee-access:rate:v1:*`, `attendee-passkey:{ceremony,rate}:v1:*`, `attendee-totp:rate:v1:*`, `attendee-action:redeem:*`                                                                                       | Session, ceremony, rate-window and one-time action rows                                      |
| Reports and voting     | `diagnostic-report:{index:v1,v1:*,rate:v1:*,duplicate:v1:*,idempotency:v1:*,follow-up-lock:v1:*}`; `best-dressed:{votes:v2,session,open-until,token:*,voted:*,code:*,code-index}`                                                                                                 | Reports/receipts/retention and atomic vote eligibility                                       |
| General rate/cache     | `ratelimit:*`, `pitches:recover:*`, `admin:content-audit:v1`, `mah:health:probe`                                                                                                                                                                                                  | Rate windows, disposable cache and health probe                                              |
| Multiplayer            | `things:{same-brain,liars,draw-country,centre,twin,spelling-party,hot-and-cold,family-feud}:v*:room:*:{state,lock,join-receipt:*,log,replay:*}`; `things:remote:v3:room:*` meta/setup/snapshot/commands/receipts/presence/epochs/rate/sequence; `things:official-result-outbox:*` | Versioned room state, credentials, action receipts and result outbox                         |
| Pool and presentations | `things:game-pool:v1:run:*:{room:*:join-token,assignment:*}`, `pitches:presentation:*` and locks                                                                                                                                                                                  | Expiring assignment/presentation recovery                                                    |

The `events:*` and `tickets:*` record/index helpers in
[events/config.server.ts](../features/events/config.server.ts) have no active callers. Ticket
workflows import only its rate-limit key builders, passed as identities to the general
`ratelimit:*` adapter. The supplied export contains none of the old event/ticket record keys.

Browser state remains on the device: transfer upload recovery and last result in session storage,
gallery selections, local multiplayer credentials/invites/pending commands/drafts and preferences,
game-pool membership/client ID, and Pitch Studio IndexedDB credentials/drafts/media (plus its
device ID in local storage). [Active room recovery](../features/things/shared/active-room-recovery.ts)
discovers local and session credentials by key pattern. Server migration must preserve their
existing expiry, credential and action-reconciliation contracts without a browser wipe.

## Source ownership map

This map identifies implementation roots to inspect. It does not yet claim every key, script,
object reference or browser recovery path is accounted for.

| State                                                                                | Current authority / entry points                                                                                                                                                                                                                          | Planned authority                                               |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Relational events, tickets, people, communications, pitches and retained scoring     | [migrations](../lib/platform/migrations.server.ts), [Postgres adapter](../lib/platform/postgres.server.ts)                                                                                                                                                | Existing Postgres tables with evidenced integrity changes       |
| Word metadata, share/PIN state and indexes                                           | [word store](../features/words/store.server.ts), [share store](../features/words/share.server.ts) in Redis; Markdown and media in R2                                                                                                                      | Postgres content and access records; R2 binaries                |
| Editable album/photo manifests and derivatives                                       | [album repository](../features/media/album-repository.server.ts) and R2                                                                                                                                                                                   | Postgres catalogue; R2 binaries/derived exports                 |
| Transfers, reservations, file/group status and media jobs                            | [transfer store](../features/transfers/store.server.ts), [reservations](../features/transfers/upload-reservation.server.ts), [queue](../features/transfers/media-queue.server.ts) in Redis; files in R2                                                   | Postgres records and transactional jobs; R2 files               |
| Media worker heartbeat and live fan-out                                              | [worker runtime](../features/system/media-worker-runtime.server.ts), [status](../features/transfers/media-worker-status.server.ts), [events](../features/transfers/media-events.server.ts)                                                                | Postgres status, claims and advisory notifications              |
| Attendee and token sessions, ceremonies, revocations, upload windows and rate limits | [attendee sessions](../features/attendee-access/session.server.ts), [token sessions](../features/auth/internal/token-session.server.ts), [rate limiter](../lib/platform/rate-limit.server.ts) in Redis, with existing Postgres identity tables            | Postgres scoped security records                                |
| Reports, Best Dressed, pool and presentation state                                   | [reports](../features/reports/report-store.server.ts), [Best Dressed](../features/best-dressed/best-dressed.server.ts), [pool](../features/things/pool/pool-redis.server.ts), [presentations](../features/things/pitches/presentation.server.ts) in Redis | Postgres domain records                                         |
| Multiplayer rooms, action receipts, result outbox and wake fan-out                   | [room engines](../features/things/shared/room-primitives.server.ts), [result outbox](../features/game-results/outbox.server.ts), [backplane](../features/things/shared/multiplayer-realtime-backplane.server.ts) in Redis                                 | Postgres room/recovery/result authority; advisory notifications |

## Open M1 evidence and decisions

- [x] Obtain and checksum-validate a readable Redis export, decode all 224 keys, types and absolute
      TTLs without printing private values.
- [x] Identify the three legacy keys and their original owning code in Git history; preserve the
      guest list in the protected export pending a retention decision.
- [ ] Establish exact source snapshot time, refresh the export at cutover, and decide whether
      legacy guest data is imported to a restricted archive or retained only in the source export.
- [ ] Establish exact production counts and contradictions from the source and target, including
      transfers, active work, content, credentials, rooms, receipts and revocations.
- [x] Reconcile exported word/transfer references and editable album/word-image manifests to R2
      objects without printing private content.
- [x] Reconcile all 47 private pitch asset references and prove the orphan job is the one with a
      missing source object.
- [ ] Verify public pitch publication references, object backup coverage and integrity policy.
- [ ] Resolve the `0025_site_settings` migration-ledger mismatch without rewriting applied SQL.
- [ ] Specify physical DDL and source mapping for every new table family; audit the full effective
      117-table schema before selecting existing-domain integrity changes.
- [ ] Measure query/connection and media/room load; set numerical performance and recovery gates.
- [ ] Establish database backup schedule and restore evidence before cutover authorization.

The original schema dump and statistics remain outside Git because they are operational evidence;
this document records their paths and hash, not their raw contents.
