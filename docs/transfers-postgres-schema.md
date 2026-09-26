# Staged Postgres transfer schema

Migration `0111_transfer_catalogue_and_media_jobs` creates separate transfer, file, group,
group-member, presign-reservation and media-job tables. It is additive. The application still
reads and writes Redis transfers and jobs; no production switch or import has occurred.

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
It does not yet coordinate outstanding append reservations or worker generations. A staged
tombstone hides a deleted transfer, cancels pending/claimed jobs, and enqueues deletion of its
known private R2 object keys in the same transaction. Migration `0113` permits `transfer` as an
object-operation owner. A failed enqueue rolls the tombstone back. The object-operation executor
can claim only transfer-owned deletes, retry an uncertain R2 response, and leave album/word
operations untouched. It is not started by the Media runtime yet. Orphan-prefix reconciliation
is also required before selecting this delete path.
Admin and owner summary lists count files in one Postgres query; the owner predicate is applied
in SQL, and deleted/expired rows are omitted.
Object execution, file removal and expiry workflows are still pending, so the application has
not selected this repository.

The staged [Postgres reservation repository](../features/transfers/upload-reservation-postgres.server.ts)
hashes the deletion token, actor JTI and file selection separately, records reserved count and
bytes, admits one concurrent claimant, and hides expired rows. It is not wired into the upload
workflow yet: finalization, resume, abandon and orphan-object cleanup must switch together so
all of them consult the same reservation authority.
The staged finalization transaction locks the matching reservation, verifies the hashed
capabilities and selected file IDs, bounds stored bytes by the presign reservation, creates the
transfer catalogue, and consumes the reservation in one commit. Resume, abandon, object cleanup
and the live upload path still use Redis.

Jobs have a unique source/operation/generation identity, a claim token, lease, attempt count and
indexed pending/expired-lease states. Their JSON payload retains source request details while
the relational columns own routing and concurrency. The table is only a foundation: enqueue
must commit beside file state, and completion must check the current claim token and file
generation before publishing. Output keys must include the generation so a stale worker cannot
overwrite a current derivative.

The staged [media-job repository](../features/transfers/media-jobs-postgres.server.ts) requires
an existing file with the matching generation in the enqueue transaction. Workers claim due jobs
with `SKIP LOCKED`, renew with a claim token, retry or dead-letter failed attempts, and cancel
jobs whose source is deleted, expired or superseded. Completion locks the transfer and file,
checks the claim, and updates the file result in the caller's transaction. It does not execute
R2 work yet. Manual dead-letter retry, queue snapshots, worker loop integration and
generation-specific object keys remain open.

The supplied RDB contains one active transfer and eight unleased entries in the processing
list. One entry has no surviving transfer and no R2 source object. The importer retains that
orphan's provenance in a restricted quarantine record and does not enqueue it as runnable work.
A fresh source delta is needed before cutover. No migration in this stage reads or mutates
production data.

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
Production remains unchanged; obtain and reconcile a fresh source delta before cutover.
