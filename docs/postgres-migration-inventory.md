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

Object counts are not proof of application references, backup coverage or content integrity. A
production Redis namespace/type/TTL inventory remains unavailable while the Upstash monthly
command limit rejects reads. A verified readable export is required for M1 source mapping and M10
rehearsal; a words-only archive is insufficient.

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

- [ ] Obtain the complete readable Redis export with capture time, types, values and remaining TTLs;
      enumerate unknown key families and independently stored records.
- [ ] Establish exact production counts and contradictions from the source and target, including
      transfers, active work, content, credentials, rooms, receipts and revocations.
- [ ] Inventory all R2 object references and editable manifests, not just top-level prefixes;
      verify object backup coverage and integrity policy.
- [ ] Resolve the `0025_site_settings` migration-ledger mismatch without rewriting applied SQL.
- [ ] Specify physical DDL and source mapping for every new table family; audit the full effective
      117-table schema before selecting existing-domain integrity changes.
- [ ] Measure query/connection and media/room load; set numerical performance and recovery gates.
- [ ] Establish database backup schedule and restore evidence before cutover authorization.

The original schema dump and statistics remain outside Git because they are operational evidence;
this document records their paths and hash, not their raw contents.
