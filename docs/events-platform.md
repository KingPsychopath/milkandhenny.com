# Events platform

Status: current product and architecture overview

Milk & Henny operates public events, paid and complimentary tickets, attendee access, door and
checkpoint admission, communications, waitlists, event scoring, and event-night games inside the
modular monolith.

## Ownership

| Module                         | Responsibility                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `features/events`              | Event records, publication, public detail, event drops, maps, and calendar output   |
| `features/tickets`             | Inventory, checkout, issuance, QR authority, redemption, refunds, and scanner rules |
| `features/attendee-operations` | Attendee identity, capabilities, access links, handoff, and notifications           |
| `features/event-operations`    | Neutral workflows that compose events, tickets, payments, and attendee operations   |
| `features/event-scoring`       | Ledger, projections, staff assignments, discoveries, claims, and lifecycle          |
| `features/communications`      | Staged communications, waitlists, and bounded durable email delivery                |
| `features/game-results`        | Neutral official-result envelopes and durable delivery to event scoring             |

Routes validate transport input, perform coarse authentication, call these workflows, and shape
responses. They do not decide ticket eligibility, refundability, capacity, scoring, or attendee
authority. Cross-feature logic belongs in `event-operations` or another neutral composition edge;
events and tickets do not import one another in both directions.

## Data ownership

Postgres is authoritative for events, ticket types, checkouts, tickets, redemptions, attendee and
staff identity, scoring, communications, waitlists, scheduler leases, and audit records. Capacity,
single admission, refunds, and durable outbox writes rely on transactions and constraints.

Redis owns expiring authentication/session state, rate limits, multiplayer rooms, advisory wakes,
and official-result records created atomically beside Redis-owned game state. R2 owns event and
attendee media blobs. Neither Redis publication nor an in-memory fiber substitutes for a Postgres
or Redis durable record.

## Runtime and scheduling

Events, tickets, attendee operations, event operations, staff access, scoring, communications, and
the application scheduler share the Events `ManagedRuntime`. Pure policy and repositories remain
ordinary TypeScript. The runtime owns cancellation, deadlines, typed workflow failures, bounded
delivery, scheduled fibers, advisory publication, telemetry, and resource finalization.

The scheduler starts only after Postgres migrations are ready. Durable Postgres leases prevent
overlap across replicas and deploys. It runs communications, scoring transitions and result
recovery, Pitch reminders, and operations digests. Daily maintenance remains an independent
housekeeping and recovery backstop.

See [effect-lifecycle.md](./effect-lifecycle.md), [durable-work.md](./durable-work.md), and
[operations.md](./operations.md).

## Tickets and payments

- Ticket types and event capacity are enforced in the final database transaction.
- Paid issuance follows a signature-verified Stripe webhook, not the success redirect. Provider and
  domain idempotency prevent duplicate issuance.
- Complimentary tickets use the same issuance rules without a payment provider.
- Each admission entitlement has its own ticket authority. A successful online redemption is
  single-use under concurrency.
- Refunds return to the original payment method and invalidate only the affected entitlement unless
  an event-level cancellation workflow says otherwise.
- Transfers are assignment/handoff, not a resale marketplace. Product policy is recorded in
  [ticket-transfer-and-refund-policy.md](./ticket-transfer-and-refund-policy.md).
- A timeout or disconnect during a provider mutation has an uncertain outcome. Reconciliation reads
  Stripe and durable application state before deciding whether to retry.

Hosted Stripe Checkout keeps card data outside the application. Stripe remains the financial
receipt owner; Milk & Henny sends ticket and operational messages through its own outbox.

## Location, identity, and privacy

Public event pages expose only deliberately public location information. Exact venue data follows
the event's visibility policy and ticket-holder authority consistently across the page, calendar
files, maps, and messages.

Ticket ownership, attendee identity, and score identity are related but distinct. A ticket grants
admission authority; an event participant owns ledger entries; a verified person may link several
eligible records without moving immutable score history. Generated aliases are the public default,
and private names remain restricted to authorized operational surfaces.

Private ticket, attendee, staff, and score responses use `private, no-store`. Credentials, email
addresses, names, room IDs, and raw provider payloads are never telemetry labels.

## Waitlists and communications

Waitlists are verified, one-shot availability alerts, not reservations. A confirmed person may
wait for the event or a ticket type. Reconciliation selects eligible entries in FIFO order and caps
the batch to newly available capacity; one returned ticket must not notify the entire list.

The waitlist transition and email-outbox insert share a Postgres transaction. Stable idempotency
keys make staging safe to repeat. The communication worker owns bounded concurrent provider
delivery, deadlines, suppression, retries, feedback, and retention. Provider acceptance is not
inbox delivery.

## Scoring and event-night games

Games publish versioned, neutral official results. They do not import the scoring ledger or know
event point values. Event scoring owns eligibility, bindings, point conversion, claims, holds,
reversals, and participant/team attribution.

Score rules, balance calculations, rank rules, and eligibility stay pure. The Events runtime owns
transactional orchestration, result consumption, realtime score publication, retries for safe
operations, and telemetry. A game remains playable when event scoring is disabled.

Operational policy and closeout are in
[event-scoring/operations.md](./event-scoring/operations.md). The completed implementation checklist
in [event-scoring/README.md](./event-scoring/README.md) is historical evidence and not a substitute
for current verification.

## Door and event-night verification

The scanner is QR-first with manual search or entry as a recovery path. Offline admission may use a
signed, privacy-bounded manifest and queue, but the server redemption transaction remains the only
authoritative way to detect a duplicate across devices.

Software tests cannot prove camera focus, battery life, venue Wi-Fi behavior, printer output, or a
human escalation runbook. Re-run the software and physical checks in
[event-night-readiness.md](./event-night-readiness.md) for each material event; its recorded evidence
is a dated snapshot, not permanent readiness.
