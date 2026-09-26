# Staged Postgres transfer schema

Migration `0111_transfer_catalogue_and_media_jobs` creates separate transfer, file, group,
group-member, presign-reservation and media-job tables. It is additive. The application still
reads and writes Redis transfers and jobs; no production switch or import has occurred.

The transfer row preserves the public capability ID, owner, title and expiry. It has a deletion
token hash for verification and ciphertext/nonce columns for the existing resume flow, which
must return the token after finalization. The staged
[deletion-token codec](../features/transfers/delete-token-postgres.server.ts) derives a distinct
AES-GCM key from the web role's `AUTH_SECRET`, binds ciphertext to the transfer ID, and appends
the authentication tag. A future repository must omit token decryption on the worker role and
keep the same secret available for the lifetime of surviving transfers. Files keep stable IDs,
positions and media-processing fields. Composite foreign keys keep group members and jobs
attached to files in their own transfer. Reservations intentionally have no transfer FK because
presign creates them before finalization creates the transfer.

The staged [Postgres reservation repository](../features/transfers/upload-reservation-postgres.server.ts)
hashes the deletion token, actor JTI and file selection separately, records reserved count and
bytes, admits one concurrent claimant, and hides expired rows. It is not wired into the upload
workflow yet: finalization, resume, abandon and orphan-object cleanup must switch together so
all of them consult the same reservation authority.

Jobs have a unique source/operation/generation identity, a claim token, lease, attempt count and
indexed pending/expired-lease states. Their JSON payload retains source request details while
the relational columns own routing and concurrency. The table is only a foundation: enqueue
must commit beside file state, and completion must check the current claim token and file
generation before publishing. Output keys must include the generation so a stale worker cannot
overwrite a current derivative.

The supplied RDB contains one active transfer and eight unleased entries in the processing
list. One entry has no surviving transfer and no R2 source object. The future importer must
retain that orphan's provenance in a restricted quarantine record and must not enqueue it as
runnable work. A fresh source delta is needed before cutover. No migration in this stage reads
or mutates production data.
