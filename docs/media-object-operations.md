# Media object operations

The Postgres `media_object_operations` ledger records R2 work beside the mutation that creates it.
Albums enqueue publication copies and deletions; deleted words and transfers enqueue private
object cleanup. The Media runtime drains these records in bounded batches.

## Enqueue and claim

Each record identifies its owner and revision, operation, source and target, availability,
attempt count, claim token, lease, and error code. Enqueue occurs inside the owner's transaction.
Repeating the same owner/revision/target operation returns its existing row; a different payload
under that identity fails.

Claims use `FOR UPDATE SKIP LOCKED`. An expired lease can be reclaimed. Renewal and settlement
require the current unexpired claim token; exhausted attempts become dead records. A lost wake
cannot remove queued work.

## Owner-specific execution

- [Albums](../features/media/album-object-deletions.server.ts) hold the album mutation lock across
  the R2 operation. Publication copies require the current publishing revision. Deletions check
  whether the target remains referenced. The album becomes published after its copies settle.
- [Words](../features/words/media-deletions.server.ts) serialize cleanup with slug reuse, verify
  that no word owns the slug, and limit deletion to its media prefix.
- [Transfers](../features/transfers/object-deletions.server.ts) accept only private-object
  deletions. Deleting an already absent object is safe to repeat after an uncertain response.

The [Media runtime](../features/system/media-worker-runtime.server.ts) enables the album and
transfer loops with `ALBUM_OBJECT_DELETION_RUNNER=postgres` and
`TRANSFER_OBJECT_DELETION_RUNNER=postgres`. Word cleanup follows `WORD_STORE=postgres`.
See [the worker runbook](media-worker.md) for configuration and recovery.
