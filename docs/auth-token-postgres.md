# JWT token-state migration

Status: opt-in Postgres backend verified locally. Production remains on Redis. Do not set
`AUTH_TOKEN_STORE=postgres` until a fresh Redis snapshot has been reconciled and all active JWT
sessions, revocations and 15-second dedupe records are imported or safely expired during the
planned writer freeze. The supplied 2026-09-26 RDB has no `auth:session:*`,
`auth:revoked-jti:*` or `auth:recent-login:*` records, but this may change before cutover.

`AUTH_TOKEN_STORE=postgres` switches JWT version reads and increments, verification, session
registration, login deduplication, logout revocation, and admin session listing/revocation as one
contract. It does not switch attendee sessions or CLI authorization handshakes. The latter still
require Redis and block the overall Redis retirement gate.

The RDB contains `auth:token-version:admin=3`, `upload=2` and historical `staff=2`. Current code
accepts admin and upload JWTs only. The staff value is retained in Postgres with source provenance
but does not authorize a staff role. Missing version rows mean version 1, matching the old read
path. A global role revocation increments the counter atomically and clears its source marker.

The pinned offline RDB extractor in [the guest archive runbook](./legacy-guest-archive.md) can
write a fourth, mode-0600 JSON output for role versions:

```sh
go run /absolute/path/to/milkandhenny.com/ops/legacy-guest-rdb-extract.go \
  /private/path/export.rdb /private/path/legacy-guests.json \
  /private/path/upload-audit.json /private/path/auth-versions.json
DATABASE_URL=… node ops/import-auth-token-versions.mjs RDB_SHA256 /private/path/auth-versions.json
```

Run the importer with the separate migration credential before the application starts writing
Postgres token state. It requires a private JSON file and reconciles every role/version and RDB
source hash in a transaction. Replaying the same import is safe. A changed source hash, version,
or runtime-created counter causes rollback. The import does not claim to preserve active sessions
or revocations; inspect those exact key families in the fresh export and complete their mapping
before the switch. Keep the private RDB and extracted files out of Git.

Recent-login bearer tokens are stored with AES-256-GCM under a key derived from `AUTH_SECRET`.
Changing that secret invalidates both JWT signatures and recent-login decryption. Runtime errors
fail token issuance or validation closed. Daily maintenance removes expired revocations and dedupe
records in bounded batches and retains session records for 60 days past expiry for operational
inspection.
