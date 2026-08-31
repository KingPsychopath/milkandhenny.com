# Effect v4 release-candidate upgrade

Applied on 1 September 2026. The application is pinned exactly to `effect@4.0.0-rc.112`.

The upgrade was coordinated with a repository-wide lifecycle audit. The official release source
and migration guide were checked for every API used here: `Context.Service`, `Layer.effect`,
`Layer.effectDiscard`, `Effect.acquireRelease`, `ManagedRuntime.make`, `runPromise`, `dispose`,
timeouts, schedules, tagged errors, and interruption through `AbortSignal`. This repository has no
other Effect ecosystem package that needs a matching version.

The migration retained the existing architecture rather than spreading Effect through the codebase:

- one managed runtime and one layer scope per Effect subsystem;
- Promise conversion only at TanStack/Nitro boundaries;
- explicit request cancellation and operation timeouts;
- tagged service failures and one transport mapping;
- scoped Redis pub/sub acquisition and shutdown;
- pure TypeScript game transitions, React, and local games outside Effect;
- existing transactional outboxes and leased queues instead of unstable persistence APIs.

The focused tagged-error, abort, timeout, runtime-scope, and Icebreaker tests passed after the
upgrade. The authoritative repository checks are recorded with the implementation handoff.

References: [Effect v4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md),
[Effect `4.0.0-rc.112` source](https://github.com/Effect-TS/effect/tree/effect%404.0.0-rc.112), and
[Effect releases](https://github.com/Effect-TS/effect/releases).
