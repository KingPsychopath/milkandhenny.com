# Attendee session migration

Status: opt-in Postgres backend and offline importer verified locally. Production remains on
Redis. Use `ATTENDEE_SESSION_STORE=postgres` only after importing and reconciling the accepted
2026-09-26 export under the planned writer freeze. The user accepted that Redis-only writes after
that export are outside the preservation requirement.

The backend stores one row per session, keyed by an HMAC of its opaque cookie ID under
`AUTH_SECRET`. It keeps the original JSON payload, person and pending-MFA indexes, and an absolute
expiry. Reads reject expired rows. Rotation inserts the new ID and removes the old row in one
transaction under a row lock; the cookie changes only after that transaction commits. A
person-wide revocation rotates the person's security version and deletes current and pending
sessions atomically. The daily maintenance runner removes expired rows in batches of 10,000.

The supplied RDB has 192 sessions, all with absolute expiry. Of these, 189 use schema version 1
and three have no schema-version field; 27 have a person ID and none has pending MFA. No
`event-scoring:attendee-person-session-version:*` key survives in that export. The existing
validation path handles older session shapes and version/null semantics after import.

Use the pinned offline extractor described in [the guest archive runbook](./legacy-guest-archive.md)
with its fifth output path. The output contains live session credentials and personal data; keep
it mode 0600, outside Git and under the same private retention as the RDB:

```sh
go run /absolute/path/to/milkandhenny.com/ops/legacy-guest-rdb-extract.go \
  /private/path/export.rdb /private/path/legacy-guests.json \
  /private/path/upload-audit.json /private/path/auth-versions.json \
  /private/path/attendee-sessions.json
AUTH_SECRET=… DATABASE_URL=… node ops/import-attendee-sessions.mjs \
  RDB_SHA256 /private/path/attendee-sessions.json
```

Run the importer with a migration credential and the exact application `AUTH_SECRET` that will
serve the imported cookies. It validates identities, structure and expiry, then writes all
session and person-version rows in one transaction with the source RDB hash. Repeating the same
import verifies and retains the rows. A conflicting row, another export or runtime-created state
causes rollback. The importer retains original absolute expiries, including any records that have
expired since export; these cannot authenticate and are cleaned by maintenance. It does not mint
new cookies, extend a lifetime or repair malformed source data silently.

Before switching, compare source and target counts and sample identities using HMAC lookups,
verify an existing valid cookie, a rotated cookie, and person-wide revocation against the new
backend. Retain the accepted export for the recovery window; do not run both backends as
independent writers.
