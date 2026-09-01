# Durable work

Durable work must be recorded atomically in the same datastore as the state that creates it. A
queue notification or wake signal is never a substitute for that commit.

## Approved mechanisms

| Mechanism                       | Use                                                          | Delivery and ordering                                                     | Deduplication                                                                                                                | Retry and retention                                                                                  |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Transactional Postgres outbox   | Email and other work created by Postgres-owned product state | At least once; ordered only where the domain query explicitly orders rows | Stable domain/idempotency key enforced in the transaction                                                                    | Retry transient delivery; retain operational history and permanent failures per the subsystem policy |
| Leased Redis background queue   | Blocking, high-frequency media work                          | At least once; FIFO is best effort across retries and expired leases      | Idempotent handler and stable job identity                                                                                   | Recover expired leases, retry transient failures, dead-letter poison/permanent failures              |
| Redis aggregate-adjacent outbox | Results created by Redis-owned multiplayer room state        | At least once; result revisions define domain order                       | `(channel, result, revision)` plus payload hash; the Postgres consumer is idempotent under duplicate and concurrent delivery | Keep retryable refusals until room TTL; acknowledge permanent invalid/conflicting envelopes          |
| Advisory wake signal            | Low-latency notice after a durable commit                    | At most once and unordered                                                | None required                                                                                                                | May be dropped; readers and scheduled drains reconcile authoritative state                           |

Postgres is the default for new durable work when no data-local transaction requires
Redis. Redis is appropriate for blocking workers, high-frequency ephemeral work, or when the state
that creates the work is already Redis-owned and must commit atomically with it.

## Operations

Every durable mechanism exposes a read-only `DurableWorkSnapshot`: availability, pending work,
active processing claims, permanent failures, and the oldest pending timestamp. Domain-specific
fields remain alongside this normalized view. Structured logs and metrics use the
`durable_work.<subsystem>.<operation>` namespace and the vocabulary `pending`, `processing`,
`failed`, `delivered`, and `recovered` where those words are truthful.

Workers stop accepting new claims during shutdown, finish or abandon the current claim within the
shutdown deadline, and leave unfinished work recoverable by a lease or authoritative outbox row.
Queue-specific enqueue, claim, acknowledge, suppression, feedback, and manual-retry APIs stay
specialized; there is intentionally no shared queue interface.

## No generic queue abstraction

The email outbox, media queue, and official-result outbox have different transaction, ordering,
retention, failure, and operator-access requirements. Do not replace them with a generic Effect or
provider queue merely to standardize the API. Any replacement must prove equivalent transaction
participation, idempotency, at-least-once behavior, failed-work visibility, recovery, retention,
migration, and test guarantees for that subsystem.
