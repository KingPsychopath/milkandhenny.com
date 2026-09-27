# Agent instructions

Milk & Henny is a provider-neutral TanStack Start and Nitro modular monolith. Its Docker image
runs on Railway or another container host. Use [architecture.md](./docs/architecture.md) when
changing feature boundaries, persistence, or deployment topology. Use
[room-first-multiplayer.md](./docs/room-first-multiplayer.md) when materially changing a co-located
multiplayer mode.

## Verification

Use the package manager and dependency versions in `package.json` and the runtime in the
Dockerfile. ESLint and Prettier are intentionally absent; do not add them.

- Start with the narrowest affected check. For source changes, run `pnpm check` and tests covering
  changed behavior. Run the full `pnpm test` suite for cross-feature changes or release candidates.
- Run `pnpm build` when bundling, server/client boundaries, build inputs, or packaging change. Run
  focused Playwright journeys when browser behavior changes.
- Run `pnpm verify:release` for a release candidate or when requested. For documentation-only
  changes, check formatting and affected links, paths, and commands; source tests are unnecessary
  unless the documentation exposes a code mismatch.
- Report what ran, why it covers the change, and any broader verification left to CI. See
  [testing.md](./docs/testing.md) for test tiers and setup.

## Ownership and boundaries

- `src/routes` owns routing, transport validation, response shape, and coarse authorization.
  Routes call feature workflows; they do not own product truth or construct domain policy.
- `features/*/*.functions.ts` defines TanStack server-function boundaries;
  `features/*/*.server.ts` owns workflows and durable product rules; `features/*/ui` owns rendering
  and interaction. Compose cross-feature work at a neutral edge such as `features/event-operations`;
  avoid bidirectional feature imports.
- `lib/platform` owns provider adapters and runtime translation; `lib/shared` owns pure,
  environment-safe utilities. `server/plugins` owns process lifecycle. `ops` owns independently
  invoked operational workloads.
- Browser-executed code must not import secrets, `node:crypto`, or platform adapters. Put Node
  work in `.server.ts` modules behind server functions or routes; `lib/server` and operational
  `ops` scripts are also Node-only. Keep browser contracts, types, and reducers environment-safe.

## Runtime and persistence

Use Effect v4 only when a backend workflow coordinates fallible effects or needs cancellation,
deadlines, concurrency, retry policy, resource lifetime, or structured telemetry. Keep pure policy,
validation, simple queries, React, and browser state in ordinary TypeScript. One independently
started subsystem owns one `ManagedRuntime`; pass the active `AbortSignal` at boundaries. Preserve
typed domain failures and retry external mutations only with an explicit idempotency guarantee.
See [effect-lifecycle.md](./docs/effect-lifecycle.md) for the runtime map and full contract.

Postgres owns durable relational state and outboxes; Redis owns expiring state, coordination, and
metadata still awaiting migration; R2 owns blobs; Git owns source and generated build inputs.
Record durable work atomically with the state that creates it. Consumers must be idempotent and
wake signals are advisory. Use one Redis key per independently read mutable record unless a
documented consistency reason requires an aggregate. Production fails closed when required
persistence is unavailable. See [durable-work.md](./docs/durable-work.md) and
[architecture.md](./docs/architecture.md) for storage contracts and current migrations.

## Browser and UI

Use [design-language.md](./docs/design-language.md) when changing visual design and
[navigation.md](./docs/navigation.md) when changing URLs or history. Initial data comes from a
route loader or server function where available, not a client effect. Polling uses ref-stable
callbacks, a hard minimum fetch gap, cancellation, and no automatic retry for 4xx responses. Do
not import Effect or server-only modules into browser code. Reuse theme tokens from
`src/styles/globals.css`; do not hardcode component colors.

## Task-specific rules

Read only the rules relevant to the changed contract:

| Domain | Rule |
| --- | --- |
| UI and components | `.cursor/rules/design-system.mdc` |
| Accessibility and forms | `.cursor/rules/accessibility.mdc` |
| React, TanStack, and routing | `.cursor/rules/react-tanstack.mdc` |
| Operational CLI | `.cursor/rules/cli-parity.mdc` |
| Moves and codemods | `.cursor/rules/file-ops.mdc` |
| TypeScript and module boundaries | `.cursor/rules/engineering-core.mdc` |
| Testing | `.cursor/rules/testing.mdc` |
| Multiplayer scenarios | `docs/multiplayer-testing.md` |

## Working style

- Read neighboring code and extend existing feature boundaries. Prefer less code and explicit
  ownership over new abstractions.
- Do not grow `features/admin/ui/AdminDashboard.tsx`; add focused panels under
  `features/admin/ui/components/`.
- Use Conventional Commit messages. Preserve unrelated work in a dirty tree.
- Comments explain invariants or non-obvious failure modes. When code and documentation disagree,
  verify the implementation and correct the documentation in the same change. Dated audits and
  roadmaps are evidence, not current instructions.
