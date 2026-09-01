# Effect lifecycle contract

This is the normative repository contract for Effect v4. The exact prerelease is pinned in
`package.json`; an upgrade is a coordinated change.

## Adoption boundary

Use Effect when a backend workflow coordinates multiple fallible side effects or owns one of these
concerns:

- cancellation or an operation deadline;
- bounded retry, concurrency, or backpressure;
- long-lived resource acquisition and release;
- scheduled or worker fibers;
- typed infrastructure failure and uncertain mutation outcomes;
- structured spans, logs, and metrics around a workflow.

Keep ordinary TypeScript for pure rules, validation, parsing, authentication and authorization
policy, simple CRUD, individual queries/SDK calls, React, browser state, offline games, and durable
queue or outbox schemas. An async function is not an Effect candidate merely because it can fail.

```text
TanStack / Nitro / CLI / worker edge
  -> run<Subsystem>Effect (Promise conversion + AbortSignal)
     -> subsystem ManagedRuntime
        -> composed service Layer and Scope
           -> typed orchestration
              -> call pure policy or existing async repository
              -> commit authoritative state and durable work
              -> publish an advisory wake
              -> record bounded telemetry
```

## Runtime ownership

One independently started and stopped subsystem owns one runtime. A feature folder or service does
not get a runtime merely to expose an Effect API.

| Runtime     | Current responsibilities                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------ |
| Events      | Events, tickets, attendee and event operations, staff access, scoring, communications, scheduler |
| Media       | Media-worker lifecycle, transfer media processing, expiry, takedown, and cleanup                 |
| Multiplayer | Shared room workflows, realtime resources, deterministic command context, and telemetry          |
| Pitches     | Pitch Night persistence, presentation, reminders, and provider coordination                      |

Services compose into the owning runtime Layer. A compatibility facade may delegate to that runtime
but must not construct or dispose another `ManagedRuntime`. Add a new runtime only when the work has
an independent process lifecycle, resource scope, and shutdown owner.

Each runtime has one process-level shutdown registration. Shutdown stops intake, interrupts or
awaits owned fibers within the deadline, runs Layer finalizers, and disposes the runtime once.

## Ownership rules

| Concern              | Owner                              | Contract                                                                                                                                                                 |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime              | `makeManagedRuntimeHost`           | Build lazily, memoize services, reject new work after shutdown starts, and dispose idempotently.                                                                         |
| Request cancellation | Runtime host and operation wrapper | Pass the active request signal to `ManagedRuntime.runPromise`; expose Effect cancellation to Promise adapters.                                                           |
| Scoped resources     | Service Layer                      | Acquire with `Effect.acquireRelease`; release from the Layer scope. Do not open sockets, locks, or clients as unowned module-initialization side effects.                |
| Product rules        | Pure function or feature engine    | Keep eligibility, scoring, balance, ticket/refund, validation, and authorization decisions deterministic and directly testable.                                          |
| Failures             | Operation boundary                 | Preserve typed domain failures. Classify infrastructure failure once as transient, timeout, interruption, uncertain mutation, or defect.                                 |
| Retry                | Individual safe operation          | Retry reads, advisory publication, and explicitly idempotent mutations only. Bound attempts and add backoff, jitter, and telemetry where shared infrastructure benefits. |
| Durable work         | Data-local transaction             | Commit state and its outbox/queue record atomically. A wake signal never substitutes for persistence.                                                                    |
| Promise conversion   | Application edge                   | Do not scatter `runPromise` through feature engines, repositories, or provider adapters.                                                                                 |
| Telemetry            | Workflow boundary                  | Use low-cardinality operation/provider/status fields. Never use credentials, room IDs, participant IDs, email addresses, or payloads as labels.                          |

## Mutation outcomes and retry

Cancellation prevents this process from waiting indefinitely; it cannot prove that a remote system
did not commit a request. A timed-out, interrupted, or connection-lost mutation is therefore
`uncertain` unless the provider supplies a definitive response.

- Non-idempotent mutations are never retried generically.
- Idempotent mutations carry a stable provider or domain idempotency key.
- A workflow reconciles an uncertain outcome by reading authoritative state or accepting the
  provider's replay-safe response.
- State commits precede realtime publication. Publication failure leaves durable work pending for a
  drain or reconciliation pass.

## Provider services

Postgres, Redis, R2, email, and Stripe adapters remain plain async modules. An injectable Effect
service is appropriate only when an orchestration workflow consumes it and gains a real testing,
lifecycle, cancellation, or typed-failure boundary.

Do not create facade services that no workflow uses. Do not translate every query into an Effect
pipeline. Repositories continue to own SQL, Redis key shape, and provider-specific result mapping;
the service boundary coordinates those capabilities.

Test Layers substitute providers at the service boundary. They should preserve the same success,
failure, cancellation, and idempotency contract instead of returning unconstrained mocks.

## Durable workers and schedules

Effect owns worker and scheduler execution: fiber scope, deadlines, bounded concurrency, overlap
prevention, cancellation, and telemetry. Postgres or Redis continues to own leases, queues,
outboxes, attempts, and completion records.

On shutdown, stop claiming new work first. A claimed item either completes inside the drain window
or remains recoverable through its lease or durable status. An in-memory fiber is never the only
record that work exists.

## Review checklist

For every new or materially changed Effect workflow:

1. Show that orchestration or lifecycle concerns justify Effect.
2. Keep product policy in a pure function or existing feature engine.
3. Compose services into the existing subsystem runtime when one owns the lifecycle.
4. Acquire long-lived resources in a Layer scope and prove the finalizer runs.
5. Propagate the active request or worker cancellation signal and set an operation-specific timeout.
6. Preserve domain failures and classify infrastructure and uncertain mutation outcomes once.
7. Retry only a bounded, explicitly safe operation.
8. Commit durable state before advisory publication and make consumers idempotent.
9. Emit low-cardinality telemetry without logging secrets or personal data.
10. Test pure rules directly, then test timeout, interruption, finalization, idempotency, lease
    recovery, or bounded concurrency where the workflow owns those guarantees.
11. Register a new close hook only for a genuinely new runtime; otherwise reuse the subsystem's
    existing shutdown owner.
12. Run the focused tests, then the repository checks required by [testing.md](./testing.md).

References: [Effect v4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
and [Effect resource management](https://effect.website/docs/resource-management/introduction/).
