# Historical guest-list archive

Status: local tooling verified; production archive not installed or imported. This record is
historical evidence. It must not populate active attendee, ticket or guest workflows.

The 2026-09-26 Upstash export has RDB SHA-256
`9dbb17f1c44765ca74892bc00ba2eca46f2f2904f09c47768f184db8c0fc17c4`.
Its `guest:list` JSON contains 274 top-level guests and 157 nested plus-ones. The exact source
capture time is unproved, so a fresh export and delta reconciliation are required at cutover.
The private extracted JSON has SHA-256
`748b45c2730d8437f7f43db747b07c92157a5ae4b815a43a046d4a9b1c49c9eb`.
These hashes establish file identity; they do not prove that the export is the final live state.

## Boundary and prerequisites

- Install [the archive schema](../ops/legacy-guest-archive.sql) using a database administrator
  separate from the application role. The no-login owner owns the schema and table. Provision
  `mah_legacy_archive_importer` as a login with a private password for the offline import only.
  Keep its URL out of web and worker environments.
- The web/worker Postgres role must be a non-superuser, must not own the archive, and must not
  inherit either archive role. As that role, confirm `has_schema_privilege(current_user,
'legacy_archive', 'USAGE')` returns false. A shared superuser credential does not satisfy the
  restricted-table requirement.
- Generate a dedicated random 32-byte key, store it outside the application environment, and
  escrow it with the archive backup. Supply it as lowercase hex in `ARCHIVE_KEY_HEX` only to the
  offline tool. The table stores AES-256-GCM ciphertext with a random nonce, authenticated source
  identity, hashes and counts. Key loss makes the archive unreadable.
- Confirm the Postgres backup covers the archive schema and test restoring both the encrypted row
  and its key before treating the import as complete. Set a retention period and named access
  owners before production import.

## Extract a verified guest JSON file

Use the pinned Upstash RDB parser from commit
`acce847ecb5c86b38602fec8ac2a2d11e3256f9f`. The extractor
`ops/legacy-guest-rdb-extract.go` verifies the RDB structure, decodes every entry and refuses
unrecognized key families or types before writing a mode-0600 `guest:list` file. This Upstash
export has its RDB checksum disabled, so the recorded SHA-256 identifies the exact source bytes;
the parser cannot verify a CRC that is absent. Its output is a raw copy of the
stored JSON string, not a serialization of parsed records. Run it in a private workspace:

```sh
git clone https://github.com/upstash/rdb.git /private/path/upstash-rdb
git -C /private/path/upstash-rdb checkout acce847ecb5c86b38602fec8ac2a2d11e3256f9f
cd /private/path/upstash-rdb
go run /absolute/path/to/milkandhenny.com/ops/legacy-guest-rdb-extract.go \
  /private/path/export.rdb /private/path/legacy-guests.json \
  /private/path/upload-audit.json
```

Check the export hash with `shasum -a 256 /private/path/export.rdb` and record the extractor's
JSON hash and counts without printing names or other personal details. Keep both files outside
Git with restricted filesystem access. Do not send the RDB to a third-party converter; it also
contains sessions and queued work.
The optional third output is a private JSON array preserving the order of
`auth:upload-open:audit`. It contains four events in the supplied export. Import it into the
application audit table before switching `UPLOAD_ACCESS_STORE=postgres`:

```sh
DATABASE_URL=… node ops/import-upload-audit.mjs RDB_SHA256 /private/path/upload-audit.json
```

Use a database migration credential and an empty audit table. The importer verifies exact event
identity, timestamps, duration and source list position inside one transaction. Repeating the same
import is safe; an existing runtime event or a different source export causes a rollback. The
supplied export has no active `auth:upload-open` window. Recheck that exact key in a fresh cutover
export; if it is then active, preserve its existing token and expiry before switching the backend.
An optional fourth output extracts the role token-version counters for
[the JWT migration](./auth-token-postgres.md).
An optional fifth output extracts attendee sessions and their absolute expiries for
[the attendee-session migration](./attendee-session-postgres.md).
An optional sixth output extracts current and retired diagnostic reports and their
absolute expiries for [the report migration](./diagnostic-report-postgres.md).
An optional seventh output extracts active and retired Best Dressed voting state for
[the voting migration](./best-dressed-postgres.md).

## Import and verify

Run the SQL once as an administrator: `psql -v ON_ERROR_STOP=1 -f
ops/legacy-guest-archive.sql`. Separately enable login for the archive importer and set its
password interactively with `\password mah_legacy_archive_importer`. Set
`ARCHIVE_DATABASE_URL` to that role's URL and `ARCHIVE_KEY_HEX` to the separately escrowed key.
Then run:

```sh
node ops/legacy-guest-archive.mjs import RDB_SHA256 /private/path/legacy-guests.json
node ops/legacy-guest-archive.mjs verify RDB_SHA256
```

The importer requires an absolute private regular file, validates the guest-array structure,
encrypts the exact JSON bytes, inserts idempotently by RDB hash, and decrypts after insert to
verify the authenticated ciphertext, payload hash and counts. It prints hashes and counts only.
An existing RDB hash with different JSON fails. Wrong keys or tampering fail verification.
Keep the RDB and JSON under restricted retention until the fresh cutover snapshot, archive
restore drill and retention decision are recorded. No application route reads this table.
