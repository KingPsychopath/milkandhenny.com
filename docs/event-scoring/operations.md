# Historical event scoring

Live points tools, leaderboards, and automatic game-result consumption are retired. The database
retains scoring history, and explicit administrative recovery remains callable. Operational team
assignment can reuse participant records without enabling points.

## Retained data

Ledger postings, admission records, identity-merge evidence, and audit events explain past results.
Privacy handling pseudonymizes personal identity without deleting immutable financial, admission,
or score history. Retained credentials still require expiry and revocation; an old scoring record
must not grant current staff access.

## Recovery

Restore the ledger and its related identities from the same database backup. An explicit scoring
recovery should rebuild projections and compare participant counts, revisions, and balances before
any use of the recovered result. Record corrections and reversals in the audit trail.

Keep exports admin-only and step-up protected. Exclude ticket credentials, staff tokens, discovery
secrets, email addresses, and private notes from logs and routine exports.

The [implementation checklist](https://github.com/machineyearningengineer/milkandhenny.com/blob/b283af0b/docs/event-scoring/README.md)
is retained in Git history. [Events](../events-platform.md) describes the current product boundaries.
