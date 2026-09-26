# Media object operation ledger

Status: transactional Postgres queue foundation only. It has no production caller or executor;
album and word R2 workflows still use their existing direct operations.

Migration `0109_media_object_operations` stores owner identity and revision, a copy/delete target,
source details for copies, availability, attempt count, claim token/owner/lease and bounded error
code. A caller enqueues through `enqueueMediaObjectOperation` inside the same Postgres transaction
that makes its owner revision durable. Repeating an identical owner/revision/target operation
returns the same row; a different payload with the same identity fails.

Claims use `FOR UPDATE SKIP LOCKED`. An expired lease can be reclaimed with a new claim token;
renewal, completion and failure accept only the current unexpired token. Exhausted claims are
marked dead. The queue is durable and independent of a wake signal. Retrying a copy or delete
will be safe only when the executor uses immutable source generations and verifies the current
owner revision. A stale external R2 mutation can still happen if owner edits or deletion race
with an in-flight operation, so those workflows must block or fence conflicting generations
before this ledger is used for production side effects.

The next implementation step is to bind album and word mutations, object references and their
pending generations to ledger inserts; add an idempotent executor to the existing Media runtime;
then test interruption before/after each R2 mutation, lease expiry, stale completion, concurrent
edits and reference-safe deletion. Do not select the Postgres album/word stores until those
paths and reconciliation have passed.
