# Agent instructions

This file is the repository entry point for coding agents. Keep it short and normative. Detailed
contracts live in the linked documents; dated audits and completed checklists are evidence, not
instructions for current work.

## 1. Application and architecture

Milk & Henny is a provider-neutral TanStack Start application served by Nitro as one Node process.
It is a modular monolith for writing, photo galleries, party games, private transfers, and
events/ticketing. The same production artifact runs through the included Dockerfile on Railway, a
VPS, or another container host.

Read [docs/architecture.md](./docs/architecture.md) before structural work. Read
[docs/room-first-multiplayer.md](./docs/room-first-multiplayer.md) before creating or materially
changing a co-located multiplayer mode.

## 2. Toolchain and verification

Use the package manager and dependency versions pinned in `package.json` and the runtime version in
the Dockerfile. Do not duplicate those versions in documentation. ESLint and Prettier are
intentionally absent; do not add them or their configuration.

Use blast-radius-based verification:

- During iteration, run the narrowest relevant test or check.
- Before handing off a source change, run `pnpm check` and `pnpm test`.
- Run `pnpm build` when bundling, server/client boundaries, build inputs, or deployment packaging
  changed.
- Run focused Playwright journeys when browser behavior changed. Run `pnpm verify:release` for a
  release candidate or when explicitly requested.
- For documentation-only changes, verify formatting, local links, referenced paths, and documented
  commands; source tests are unnecessary unless the documentation change exposes a code mismatch.

Record what ran, why it is sufficient, and what broader verification is deferred to CI.

## 3. Ownership

| Layer                       | Owns                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `src/routes`                | Routing, transport validation, response shape, coarse authorization |
| `features/*/*.functions.ts` | TanStack server-function boundaries                                 |
| `features/*/*.server.ts`    | Feature workflows and durable product rules                         |
| `features/*/ui`             | User interaction and rendering                                      |
| `lib/platform`              | Provider adapters, logging, runtime and infrastructure translation  |
| `lib/shared`                | Environment-safe constants and pure utilities                       |
| `server/plugins`            | Process startup and shutdown integration                             |
| `ops` and `deploy`          | Independently invoked operational workloads                          |

Routes do not own product truth. They validate transport input, perform coarse authentication,
call a feature workflow, and shape the response. Feature workflows return domain results rather
than constructing HTTP responses.

Cross-feature workflows belong at a neutral composition edge such as `features/event-operations`.
Do not create bidirectional feature imports or move business decisions into a route to avoid a
cycle.

Anything importing secrets, `node:crypto`, or a platform adapter must stay behind a `.server.ts`
boundary. Browser contracts, feature `types.ts`, reducers, and shared utilities remain pure and
environment-safe.

## 4. Effect

Effect v4 is an orchestration boundary, not the default programming style. Use it when a backend
workflow coordinates multiple fallible side effects or needs cancellation, deadlines, bounded
concurrency, retry policy, resource lifetime, or structured telemetry.

Keep these as ordinary TypeScript:

- scoring, eligibility, balance, ticket, refund, and authorization policies;
- validation, parsing, reducers, and deterministic game transitions;
- simple CRUD and individual Redis/Postgres queries or SDK calls;
- React, browser state, offline games, and durable queue/outbox data models.

The runtime map is:

| Runtime     | Responsibilities                                                                   |
| ----------- | ---------------------------------------------------------------------------------- |
| Events      | Events, tickets, attendee operations, scoring, communications, and app scheduling |
| Media       | Media-worker lifecycle and private-transfer orchestration                         |
| Multiplayer | Shared server-authoritative room workflows and realtime resources                 |
| Pitches     | Pitch Night server workflows and presentation lifecycle                          |

One independently started and stopped subsystem gets one `ManagedRuntime`. Extend its Layer; do
not create a runtime or Nitro close plugin per folder or service. Compatibility facades may reuse a
shared runtime but must not own another one.

Promise conversion belongs at TanStack, Nitro, CLI, or worker edges. Pass the active
`AbortSignal`. Preserve typed domain failures, classify infrastructure failures once, and treat a
timed-out or interrupted external mutation as potentially uncertain. Retry only reads, advisory
publication, or mutations with an explicit idempotency guarantee.

Effect controls execution, not durable truth. Postgres transactions, Redis queues/outboxes, leases,
and R2 objects remain authoritative. Add injectable provider services only when a workflow consumes
them and substitution, lifecycle, or typed failure handling provides real value; do not wrap every
query or SDK call.

The complete contract is [docs/effect-lifecycle.md](./docs/effect-lifecycle.md). Effect is pinned to
an exact prerelease in `package.json`; treat an upgrade as a coordinated change.

## 5. Persistence and durable work

Choose storage by responsibility:

| Store    | Owns                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| Postgres | Durable relational product state, transactions, leases, and transactional outboxes      |
| Redis    | Expiring sessions, rate limits, rooms, transfer/word metadata, coordination, and queues |
| R2       | Private source blobs and intentional public media derivatives                           |
| Git      | Source, configuration, migrations, fixtures, and generated build inputs                 |

Durable work is recorded atomically beside the state that creates it. Wake signals are advisory and
may be lost. Consumers must be idempotent. See [docs/durable-work.md](./docs/durable-work.md).

Use one Redis key per independently read mutable record. Domain-specific queues, indexes, and atomic
aggregate/outbox structures require a documented consistency reason. Never restore the retired
single-key collection pattern described in
[docs/postmortem-guestlist-kv-read-spike.md](./docs/postmortem-guestlist-kv-read-spike.md).

Production fails closed when required persistence is unavailable. In-memory implementations are
allowed only in explicit development or test paths.

## 6. Browser and design rules

Read [docs/design-language.md](./docs/design-language.md) before UI work and
[docs/navigation.md](./docs/navigation.md) before changing URLs, history, or navigation.

Do not import Effect or server-only modules into browser code. Do not use a client effect as the
initial data-loading boundary when a route loader or server function can provide the data. Polling
uses ref-stable callbacks, a hard minimum fetch gap, cancellation, and no automatic retry for 4xx
responses.

The editorial site uses the warm-stone design language. Operational surfaces such as admin, games,
scanners, and the pitch studio may use task-appropriate layouts while retaining the same tokens,
typography, interaction hierarchy, and accessibility baseline. Never hardcode component colors;
add or reuse theme tokens in `src/styles/globals.css`.

## 7. Deeper rules

Load the relevant rule before working in that domain:

| Task domain                                     | Rule or document                        |
| ----------------------------------------------- | --------------------------------------- |
| UI, CSS, and components                         | `.cursor/rules/design-system.mdc`       |
| Accessibility, forms, focus, and semantics      | `.cursor/rules/accessibility.mdc`       |
| React, TanStack, routing, and client boundaries | `.cursor/rules/react-tanstack.mdc`      |
| CLI and operational admin commands              | `.cursor/rules/cli-parity.mdc`          |
| Moves, renames, and codemods                     | `.cursor/rules/file-ops.mdc`            |
| TypeScript, safety, and module boundaries       | `.cursor/rules/engineering-core.mdc`    |
| Testing                                          | `.cursor/rules/testing.mdc`             |
| Co-located multiplayer product design           | `docs/room-first-multiplayer.md`         |
| Multiplayer harnesses and scenarios             | `docs/multiplayer-testing.md`            |

## 8. Working style

- Read neighboring code before writing and prefer extending an existing feature boundary.
- Prefer less code, fewer branches, and explicit ownership over new abstractions.
- Do not grow `features/admin/ui/AdminDashboard.tsx`; add focused panels under
  `features/admin/ui/components/`.
- Comments explain why, especially an invariant or non-obvious failure mode.
- Use Conventional Commit messages.
- Preserve unrelated work in a dirty tree. Never silently overwrite concurrent edits.
- When code, configuration, and documentation disagree, verify the implementation and correct the
  documentation in the same change. Do not present a dated audit or roadmap as current behavior.
