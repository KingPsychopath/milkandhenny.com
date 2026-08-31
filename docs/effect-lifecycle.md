# Effect lifecycle contract

Checked against Effect `4.0.0-rc.112` on 1 September 2026. This is the repository contract for
using Effect. It records both what Effect owns and where ordinary TypeScript remains the better
tool.

## Boundary

Effect owns asynchronous orchestration for the events/tickets, Pitch Night, and multiplayer
subsystems. It does not own React components, hooks, browser state, offline games, scoring helpers,
validation helpers, or pure game rules.

```text
TanStack / Nitro edge
  -> run<Subsystem>Effect (Promise conversion and request AbortSignal)
     -> one ManagedRuntime host per subsystem
        -> service Layer and its Scope
           -> typed workflow
              -> acquire time, randomness, IDs and infrastructure
              -> call pure domain transition
              -> commit authoritative state and durable outbox
              -> publish advisory wake
              -> record bounded telemetry
```

## Ownership rules

| Concern              | Owner                              | Contract                                                                                                                                                                                           |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime              | `makeManagedRuntimeHost`           | Builds lazily, memoizes services, tracks work, rejects work after shutdown starts, and disposes once.                                                                                              |
| Request cancellation | Runtime host and `effectOperation` | Pass the active request signal into `ManagedRuntime.runPromise`; expose Effect's signal to Promise adapters.                                                                                       |
| Scoped resources     | Service `Layer`                    | Acquire with `Effect.acquireRelease`; release from the layer scope. Never leave sockets, locks, or connections in module initialization.                                                           |
| Failures             | Tagged service errors              | Domain failures stay typed. Infrastructure causes are classified once as domain, transient, timeout, interruption, or defect.                                                                      |
| Mutation outcome     | Operation boundary                 | A timed-out, interrupted, or transient mutation is `uncertain`; non-idempotent mutation retries are forbidden. A raw request interruption is conservatively uncertain at the generic Promise edge. |
| Retry                | Individual safe operation          | Reads, explicitly idempotent mutations, and advisory publication only; use bounded attempts, backoff, jitter, and telemetry.                                                                       |
| Durable work         | Data-local transaction             | State and outbox commit atomically. Wake signals never substitute for persistence.                                                                                                                 |
| Promise conversion   | TanStack/Nitro edge                | `runPromise` is not scattered through engines or infrastructure adapters.                                                                                                                          |
| Shutdown             | Nitro close hook                   | Stop intake, interrupt/await runtime work, release layer scope, close external resources once.                                                                                                     |

## Subsystem audit

| Subsystem                        | Runtime and close owner                                                  | Resource notes                                                                                                                                                         | Status                    |
| -------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Events and tickets               | `events-runtime.server.ts`; `server/plugins/events-runtime.ts`           | Shared managed host; request cancellation, typed operations, and transport mapping are centralized.                                                                    | Conforms                  |
| Pitch Night                      | `pitches-runtime.server.ts`; `server/plugins/pitches-runtime.ts`         | Shared managed host; operation classification preserves domain-blocked failures.                                                                                       | Conforms                  |
| Multiplayer                      | `multiplayer-runtime.server.ts`; `server/plugins/multiplayer-runtime.ts` | HMR-safe process holder; Redis publisher/subscriber are scoped; mode changes only after subscription readiness; remote retries cannot duplicate local delivery.        | Conforms                  |
| Application scheduler            | `scheduled-jobs.server.ts`; scheduler Nitro plugin                       | Timer ownership is explicit and specialized; stop clears timers and awaits active jobs. It calls Effect subsystems only through their runtime edge.                    | Intentionally plain async |
| Media and durable workers        | Worker entry point and leased queue/outbox owners                        | Existing recovery and transaction guarantees are stronger and more domain-specific than an unstable generic Effect queue.                                              | Intentionally plain async |
| Icebreaker and other local games | React plus pure feature modules                                          | Device identity and QR camera cleanup use React lifecycle; pairing, ledger, questions, and game results remain deterministic ordinary TypeScript where replay matters. | Effect excluded           |

## Review checklist

For every new or materially changed Effect workflow:

1. Keep product rules in a pure function or the feature engine.
2. Model dependencies as services only when substitution, lifecycle, or typed orchestration benefits
   are real.
3. Put long-lived resource acquisition in a layer scope and prove its finalizer runs.
4. Propagate the request signal and choose an operation-specific timeout.
5. Preserve domain failures; classify infrastructure failure and uncertain mutation outcomes once.
6. Retry only a bounded, explicitly safe operation. Add backoff and jitter for shared infrastructure.
7. Commit durable state before advisory publication and make consumers idempotent.
8. Emit low-cardinality logs, spans, and metrics without logging secrets or room state.
9. Test pure transitions directly, then test the service boundary with deterministic layers and
   cancellation/finalization cases.
10. Add the subsystem to a Nitro close hook and run typecheck, lint, and the affected tests.

Official references: [Effect v4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md),
[Effect `4.0.0-rc.112` source](https://github.com/Effect-TS/effect/tree/effect%404.0.0-rc.112),
and [Effect resource management](https://effect.website/docs/resource-management/introduction/).
