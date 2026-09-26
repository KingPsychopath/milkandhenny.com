# Best Dressed Postgres migration

Status: opt-in implementation rehearsed locally; no production import or switch has occurred.

Migration `0105_best_dressed` stores the active session and voting window, per-candidate
totals, voter receipts, vote tokens and one-time codes. The vote transaction locks the
session row, checks eligibility and unexpired credentials, inserts the voter receipt,
increments exactly one tally, and consumes the token and code together. A clear changes
the session and removes current totals and receipts in one transaction. The existing
rate limiter remains a separate abuse-admission step.

Set `BEST_DRESSED_STORE=postgres` and `RATE_LIMIT_STORE=postgres` together only after
the final source export is imported and reconciled. The previous Redis path remains the
default. `AUTH_SECRET` must stay unchanged across the switch because the target hashes
voter cookies, vote tokens and codes with it. The daily maintenance workload calls
`/api/cron/cleanup-best-dressed` to remove expired credentials; reads enforce expiry
even if cleanup is delayed.

## Source finding and import

The supplied 2026-09-26 RDB has a persistent `best-dressed:session` and a persistent
`best-dressed:votes` value with 23 entries. The latter is an older key that the current
application does not read; the active `best-dressed:votes:v2` key is absent. It also
has no active voting window, voter receipt, vote token or code keys. The active target
baseline is therefore zero. The old tally is preserved verbatim in
`best_dressed_legacy_votes`, which the restricted runtime role cannot read. It must
not be added to active totals or interpreted as 23 ballots.

The strict `ops/legacy-guest-rdb-extract.go` tool accepts a seventh optional output path
for private mode-0600 Best Dressed JSON. It includes the current session, active v2 tally
if present, the retired value, and surviving credential/receipt keys with original
absolute expiries. Its output prints counts, not candidate names, codes or tokens.

After applying migration `0105`, run before the Postgres voting path starts accepting
writes:

```sh
AUTH_SECRET=… DATABASE_URL=… node ops/import-best-dressed.mjs RDB_SHA256 /private/path/best-dressed.json
```

The importer treats active v2 totals as a baseline and imports surviving voter receipts
as duplicate protection without incrementing the baseline. It preserves current
session/window/expiry, stores the RDB hash, can repeat with the same input, and rejects
existing runtime or other-source rows. A durable runtime revision prevents replay after
voting writes begin. A final export with new active votes, receipts
or codes must be imported from that same export. Compare source and target tallies,
receipt/credential counts and expiries; test one vote, duplicate, code use, clear and
window behavior with a non-superuser runtime role. Verify that role cannot read the
retired tally table.

Local rehearsals on 2026-09-26 imported the supplied snapshot twice into a restored
production database. A separate synthetic import started with seven active votes and
one surviving voter receipt. That voter was rejected without changing the tally; a new
valid ballot changed the tally to eight. A post-write reimport was rejected. Focused
Postgres tests covered concurrent voter and code consumption, reset, window and expiry.
