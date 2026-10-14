# Historical evidence

These documents preserve the context of earlier work. Their status statements, branch names,
counts, and deployment observations apply to the time recorded. Use [architecture](../architecture.md)
and [the docs index](../README.md) for current contracts. Check deployed state independently.

## Persistence cutover

The [original plan](https://github.com/machineyearningengineer/milkandhenny.com/blob/b283af0b19bd581f65cacd7bb52dff4982c90b57/docs/archive/postgres-cutover-plan.md) and [inventory](postgres-migration-inventory.md)
record the Postgres migration, source cutoff, import rehearsals, and acceptance gates.

Feature records preserve schema and importer details:

- Content: [Words](words-postgres.md), [gallery albums](gallery-albums-postgres.md).
- Transfers: [schema and queue](transfers-postgres-schema.md), [worker status](media-worker-status-postgres.md).
- Access: [token state](auth-token-postgres.md), [attendee sessions](attendee-session-postgres.md),
  [CLI authorization](cli-auth-postgres.md), [passkey ceremonies](passkey-ceremony-postgres.md).
- Other state: [diagnostic reports](diagnostic-report-postgres.md), [Best Dressed](best-dressed-postgres.md).

The maintained [runtime-role runbook](../postgres-runtime-roles.md) and
[guest archive tooling](../legacy-guest-archive.md) remain outside the archive.

## Architecture implementation record

[Server-state proposal and verification diary](https://github.com/machineyearningengineer/milkandhenny.com/blob/b283af0b19bd581f65cacd7bb52dff4982c90b57/docs/archive/server-state-architecture-proposal.md).
The current ownership contract is [server state](../server-state.md).

## Audits and review packets

- [System audit — 4 September 2026](https://github.com/machineyearningengineer/milkandhenny.com/blob/b283af0b19bd581f65cacd7bb52dff4982c90b57/docs/archive/system-audit-2026-09-04.md).
- [Game acceptance and group playtests — 4 September 2026](game-playtest-2026-09-04.md).
- [Hot & Cold human review packet — 4 September 2026](hot-and-cold-review-2026-09-04.md).
- [Event-night readiness snapshot](event-night-readiness.md).
- [Room-first multiplayer audit](room-first-multiplayer-audit.md).

Keep evidence with a clear date and scope. Temporary screenshots and command-output scraps can
stay out of the maintained documentation; Git history retains deleted material.
