# Diagnostic report Postgres migration

Status: opt-in implementation verified locally; no production import or switch has occurred.

Migration `0104_diagnostic_reports` adds typed report rows, hashed idempotency/duplicate
receipts, and a fixed one-hour rate row per request fingerprint. Submission, duplicate
admission, rate admission, receipt creation, and report creation share one transaction.
Follow-up notes lock the report row, so only one different note can be added. Admin group
updates lock and update all current rows in a transaction. Expiry is checked on every read;
`/api/cron/cleanup-reports` removes expired current rows, receipts, and rates in bounded
batches. The old-format report is held separately in `diagnostic_legacy_reports`, which
the restricted application role cannot read. Its original expiry remains recorded; an
archive retention decision governs physical deletion.

Set `REPORT_STORE=postgres` only after the cutover import has reconciled with a fresh
source export. Without that setting, the existing Redis report behavior remains active.
No route or browser contract changes are required.

## Offline source import

The supplied 2026-09-26 RDB has three current diagnostic records, one retired-format
`user-report:v1` record, two stale members in the current index, and no current
receipt or rate keys. The three current records have original absolute expiries; the
retired record has an original expiry too. These counts are snapshot evidence, not a
final source delta. Do not import stale index members as records.

Use the pinned Upstash parser and `ops/legacy-guest-rdb-extract.go` with its sixth
optional output path to produce a mode-0600 report JSON export. The extractor verifies
the full RDB and writes current/retired records plus receipt and rate strings with their
absolute expiries. It fails on missing expiry or malformed JSON. Keep the export outside
Git and avoid printing report content.

After installing migrations with an administrator URL and before starting report writes
on Postgres, run:

```sh
DATABASE_URL=… node ops/import-diagnostic-reports.mjs RDB_SHA256 /private/path/reports.json
```

The importer validates identities, hashes receipt/rate keys, preserves report payloads
and expiry, and records the RDB hash. It is idempotent for the same source and fails if
runtime rows or another export are present. A final snapshot with a pending reservation,
a receipt pointing to an absent report, or incompatible source data needs explicit
reconciliation before switching. Redis can count denied attempts above eight; the
Postgres rate row stores eight, which preserves the denial threshold and original expiry.

After import, compare source and target current/legacy/receipt/rate counts and original
expiry values. Exercise the admin list, duplicate retry, follow-up, update, and cleanup
paths using a non-superuser runtime role. Confirm that role has no
`diagnostic_legacy_reports` privilege. Run the daily maintenance workload after the
switch; cleanup delay never extends access because queries enforce expiry.
