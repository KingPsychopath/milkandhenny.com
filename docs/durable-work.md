# Durable work

Durable work must be recorded atomically in the same datastore as the state that creates it. A
queue notification or wake signal is never a substitute for that commit.

## Approved mechanisms

| Mechanism                     | Use                                                  | Delivery and ordering                                                 | Deduplication                                    | Retry and retention                                                        |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------- |
| Transactional Postgres outbox | Email and official results created by Postgres state | At least once; ordered where the domain query explicitly orders rows  | Stable domain/idempotency key in the transaction | Retry transient delivery; retain permanent failures per subsystem policy   |
| Leased Postgres media queue   | Media processing and object cleanup                  | At least once; order is best effort across retries and expired leases | Stable job identity and idempotent handler       | Recover expired leases, retry transient failures, retain failed jobs       |
| Advisory wake signal          | Low-latency notice after a durable commit            | At most once and unordered                                            | None required                                    | May be dropped; readers and scheduled drains reconcile authoritative state |

Production durable work is Postgres-owned. Redis queue and outbox implementations remain available
only in explicit non-production configurations while their retirement is completed.

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
