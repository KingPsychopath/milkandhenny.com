# Staged Postgres transfer schema

Migration `0111_transfer_catalogue_and_media_jobs` creates separate transfer, file, group,
group-member, presign-reservation and media-job tables. It is additive. The application still
reads and writes Redis transfers and jobs; no production switch or import has occurred.
Migration `0114` adds append reservations keyed by the selected file fingerprint. Separate
batches can reserve capacity concurrently under the locked transfer row; overlapping IDs or
names and aggregate file/byte overbooking are refused.
Migration `0115` adds a nullable published derivative generation. Null retains the existing
fixed-key URLs for imported legacy files. A Postgres worker job must name generation-specific
private output keys. Migration `0116` records claim-specific output keys for each job attempt.
The worker writes keys such as `thumb/<file-id>/g2/<claim-token>.webp`; fenced completion
publishes that generation and claim token on the file. Media access signs only the published
attempt. An expired claim can finish its R2 upload without overwriting the winning attempt.

The transfer row preserves the public capability ID, owner, title and expiry. It has a deletion
token hash for verification and ciphertext/nonce columns for the existing resume flow, which
must return the token after finalization. The staged
[deletion-token codec](../features/transfers/delete-token-postgres.server.ts) derives a distinct
AES-GCM key from the web role's `AUTH_SECRET`, binds ciphertext to the transfer ID, and appends
the authentication tag. Keep the same secret available for the lifetime of surviving transfers.
Files keep stable IDs,
positions and media-processing fields. Composite foreign keys keep group members and jobs
attached to files in their own transfer. Reservations intentionally have no transfer FK because
presign creates them before finalization creates the transfer.

The staged [catalogue repository](../features/transfers/catalogue-postgres.server.ts) commits a
transfer, its files and its groups together. It reads them under one repeatable-read snapshot.
Web reads decrypt the deletion token; worker reads omit the ciphertext columns entirely and need
no web secret. Its staged append operation locks the transfer row and checks existing IDs,
filenames, file count and stored-byte totals before inserting new files. Its regroup operation
locks the same row, rejects a changed file set, and preserves worker-owned processing fields.
Its append finalizer commits inspected files and consumes the matching reservation in one
transaction, counting every other active reservation against the quota. The Postgres media
plan queues every visual route without publishing a job early; when supplied to create or append
finalization, each matching generation-one job commits in the same transaction as its file row.
Finalizers reject a queued file without its job plan, and the Redis-era enqueue helper refuses
Postgres queue mode so a split switch cannot silently lose work. Initial presign, resume,
finalize and abandon can select the Postgres reservation and job plan together under
`TRANSFER_CATALOGUE_STORE=postgres` and `TRANSFER_MEDIA_JOB_STORE=postgres`. This remains a
staged switch; deletion and cleanup are guarded until their Postgres implementations
are connected. A staged
tombstone hides a deleted transfer, cancels pending/claimed jobs, and enqueues deletion of its
known private R2 object keys in the same transaction. Migration `0113` permits `transfer` as an
object-operation owner. A failed enqueue rolls the tombstone back. The object-operation executor
can claim only transfer-owned deletes, retry an uncertain R2 response, and leave album/word
operations untouched. The Media runtime starts a bounded 30-second deletion loop only with
`TRANSFER_OBJECT_DELETION_RUNNER=postgres`; the production switch remains unset. Orphan-prefix
reconciliation is also required before selecting this delete path.
Single-file removal uses the same durable key collection, deletes the file and its jobs in one
transaction, and removes groups left with fewer than two members. Removing the last file
tombstones the transfer. Deletion staging failure rolls the file removal back.
An indexed, bounded expiry sweep tombstones expired transfers and stages their known object
deletes once. The live cleanup cron still selects Redis until the request and cleanup paths
switch together.
Admin and owner summary lists count files in one Postgres query; the owner predicate is applied
in SQL, and deleted/expired rows are omitted.
The shared transfer read functions select the Postgres catalogue under the paired flags.
Legacy transfer mutations fail closed in that mode. Production has not selected the flags.

The staged [Postgres reservation repository](../features/transfers/upload-reservation-postgres.server.ts)
hashes the deletion token, actor JTI and file selection separately, records reserved count and
bytes, admits one concurrent claimant, and hides expired rows. The initial upload workflow now
uses it in staged Postgres mode: finalization, resume and abandon consult the same reservation
authority. Orphan-object cleanup remains open.
The staged finalization transaction locks the matching reservation, verifies the hashed
capabilities and selected file IDs, bounds stored bytes by the presign reservation, creates the
transfer catalogue, and consumes the reservation in one commit. The default live path still
uses Redis.
Append presign now reserves count, names and bytes against concurrent batches in Postgres before
minting URLs. Append finalization commits inspected files and their media jobs, infers RAW/live
photo groups and consumes the matching reservation in one transaction. The default live path
still uses Redis. Late uploads and deep object cleanup must be reconciled before selecting the
Postgres flags in production.

Jobs have a unique source/operation/generation identity, a claim token, lease, attempt count and
indexed pending/expired-lease states. Their JSON payload retains source request details while
the relational columns own routing and concurrency. Enqueue commits beside file state when the
Postgres media plan is supplied, and completion checks the current claim token and file
generation before publishing. Output keys include the generation so a stale worker cannot
overwrite a current derivative.

The staged [media-job repository](../features/transfers/media-jobs-postgres.server.ts) requires
an existing file with the matching generation in the enqueue transaction. Workers claim due jobs
with `SKIP LOCKED`, renew with a claim token, retry or dead-letter failed attempts, and cancel
jobs whose source is deleted, expired or superseded. Completion locks the transfer and file,
checks the claim, and updates the file result in the caller's transaction. A Postgres queue
snapshot reports pending, claimed, dead and expired work to admin/CLI health, and an explicit
dead-job retry grants one more attempt only while its source generation still matches.
The Media runtime periodically stages private-object deletion for known attempt outputs after
the claim loses publication rights, while keeping the file's published claim. A bounded worker
timeout stops lease renewal on interruption; expired claims are then recoverable. An R2 prefix
sweep for objects uploaded after a deletion, or never recorded in Postgres, remains open.
The repository validates the generation namespace before enqueue, assigns distinct keys to each
claim, and records the winning attempt on fenced completion. A staged Postgres executor processes
images, GIFs, videos and RAW previews, retries failed claims, and removes its own outputs when a
late completion loses the lease. The Media runtime selects this executor with
`TRANSFER_MEDIA_JOB_STORE=postgres` and requires `MEDIA_WORKER_STATUS_STORE=postgres`. Both the
long-running worker and one-shot drain avoid Redis queue claims in this mode. Orphan objects
outside the attempt ledger still need reconciliation. The Redis worker's fixed-key
path remains unchanged.

The supplied RDB contains one active transfer and eight unleased entries in the processing
list. One entry has no surviving transfer and no R2 source object. The importer retains that
orphan's provenance in a restricted quarantine record and does not enqueue it as runnable work.
The user authorized the verified first export as the Redis cutoff on 2026-09-26, accepting later
Redis-only changes as excluded. No migration in this stage reads or mutates production data.

The offline extractor's last optional output now writes a private transfer bundle with the
verified RDB SHA-256, transfer/index records, and all three media lists. Migration
`0112_transfer_media_import_quarantine` adds source provenance and a table under
`legacy_archive`; the runtime role has no access to that schema. The staged importer runs as:

```sh
AUTH_SECRET="$WEB_AUTH_SECRET" DATABASE_URL="$RESTORE_DATABASE_URL" \
  pnpm exec tsx --tsconfig tsconfig.cli.json \
  ops/import-legacy-transfers.ts "$PRIVATE_TRANSFER_BUNDLE" "$VERIFIED_RDB_SHA256"
```

Use the same web secret at cutover so surviving management tokens remain decryptable. The
importer requires a mode-0600 bundle whose embedded source hash matches the argument. It
preserves the transfer and media-job provenance in one transaction. A terminal file's stale
processing-list entry is recorded as completed rather than requeued. Missing or mismatched
source jobs are retained in restricted quarantine. The supplied export rehearsed as one transfer,
52 files, seven completed jobs, zero runnable jobs and one quarantined orphan on an isolated
production restore. The same-source import repeated, and a different hash was refused.
Production remains unchanged; reconcile the authorized first export before cutover.
