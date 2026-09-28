# Testing

The test suite protects product decisions and data integrity. It does not try to
assert every React wrapper or third-party SDK call.

Verification follows the blast radius. Start with the smallest affected test, then expand when the
change crosses a boundary, a focused check fails, or the handoff/release gate requires broader
evidence. Do not repeatedly run the full suite while iterating.

## Commands

| Command                 | Use                                             | Needs services                        |
| ----------------------- | ----------------------------------------------- | ------------------------------------- |
| `pnpm check`            | Format, type, and lint checks                   | No                                    |
| `pnpm test:unit`        | Fast pure-logic tests                           | No                                    |
| `pnpm test:integration` | Multi-module and persistence flows              | Some suites use Postgres              |
| `pnpm test`             | All Vitest tests                                | Postgres suites skip without Postgres |
| `pnpm test:coverage`    | All Vitest tests with the release coverage gate | Postgres suites skip without Postgres |
| `pnpm test:e2e`         | Critical browser journeys                       | Postgres, S3 test server, Chromium    |
| `pnpm verify:release`   | Full local release gate                         | Postgres, S3 test server, Chromium    |

## CI

[CI](../.github/workflows/ci.yml) has one `verify` job on pull requests, pushes to
`main`, and manual dispatch. Code changes run `pnpm check`, `pnpm test`,
`pnpm build`, then the Chromium journeys. CI supplies Postgres, Redis, and media
tools. Browser runs stop after the first failed test (including its retry) and
have a fifteen-minute global limit, leaving time to upload failure evidence before
the job limit. Browser failures retain screenshots and traces for seven days.

Only changes entirely within `README.md`, `AGENTS.md`, Markdown files under
`docs/`, or rule files under `.cursor/rules/` skip code verification. The job
still runs and checks diff whitespace, so a required check can complete.
Service containers still start for these runs; dependency installation, tests,
and builds are skipped. Content, unknown paths, configuration, and workflow
changes receive full verification. Renames include both old and new paths.
Manual runs and unavailable comparison commits default to full verification.

Changed Hot & Cold assets also run the judging-version guard. The full Git
history supports PR merge-base comparisons and multi-commit pushes. Generated
asset behaviour remains covered by Vitest.

Date-dependent puzzle approvals and whole-dependency vulnerability audits do
not block PR verification. Run `pnpm check:hot-and-cold-quality` for editorial
readiness and `pnpm audit --prod --audit-level high` for dependency triage when
needed; neither is scheduled by this repository. Coverage is available through
`pnpm test:coverage` and the local release gate, rather than instrumenting every
PR test run. Native-dropdown and CLI-parity policies run once in `pnpm check`.

A local Vitest run skips database-backed suites with a warning when Postgres is
unavailable. CI instead fails when its test database is unreachable. Playwright
currently tests the development server; the separate build verifies bundling,
not a production-server browser journey.

## What belongs in each layer

### Unit tests

Unit tests live in `__tests__/unit/`. Use them for pure or near-pure rules whose
failure could silently create wrong data or break several features:

- slugs, formatting, parsing, validation, and retry decisions;
- ticket QR signing and tamper rejection;
- event publishing and address-gating rules;
- game scoring and state transitions;
- client-side queue and transfer planning logic.

These tests should be quick, deterministic, and independent of a browser or a
network service.

### Integration tests

Integration tests live in `__tests__/integration/`. Use them for a real workflow
that crosses module or persistence boundaries:

- ticket issuance and single-use redemption under concurrent scans;
- checkout and payment state transitions;
- authentication and report submission;
- transfer, room, and game lifecycle rules;
- serialization and key-shape contracts.

The tests use the real application code. External services use the local
fallback or a focused test server where that is the contract being exercised.
Database suites use the shared Postgres helper and advisory lock so parallel
Vitest workers cannot reset one another's schema.

Effect service-boundary tests use deterministic Layers or focused adapters. Test pure policy before
the wrapper, then cover the execution guarantees the workflow actually owns: typed failure,
timeout, interruption, finalization, idempotency, lease recovery, overlap prevention, or bounded
concurrency. Do not assert Effect implementation details or add a mock Layer that weakens the
production contract.

### Browser tests

Browser tests live in `e2e/` and use Playwright. Keep these flows few and
high-value because they are slower and more sensitive to infrastructure. The
current journeys cover pitch creation and presentation, attendee access, staff
operations, admin draft recovery, transfers, and multiplayer identity, privacy,
refresh, and reveal.

Add a browser test when a failure would be hard to see from server tests alone:

- a critical navigation or authentication flow;
- a payment, ticket, or staff operation;
- a multi-step interaction where browser state matters;
- a multiplayer role boundary that depends on separate cookies or local
  storage;
- an offline or retry behaviour that must be observed by a user.

For navigation changes, verify the product rule rather than only the URL text:

- a shareable route opens and refreshes at the same meaningful resource;
- Back and Forward move through a live in-place mode in the expected order;
- a local game's first Back returns to setup and the next Back leaves the tool;
- an explicit end/exit action does not leave a stale history entry;
- narrow and wide headers, breadcrumbs, rails, and footers do not overlap.

Keep this coverage focused. A browser test is justified for a high-value state
transition; a pure visual spacing change can use manual visual review at the
required breakpoints. See [navigation.md](./navigation.md) for the contract.

Do not add a browser test for every component or route. Manual visual review is
better for layout and typography changes.

Multiplayer games also need a development harness that lets one person operate
every real role surface, launch deterministic scenarios, simulate other seats,
and inspect reconnect/privacy behaviour. The harness complements focused
browser tests and does not replace real-device or group playtests. See
[multiplayer-testing.md](./multiplayer-testing.md) for the canonical contract.

## What we do not test directly

Do not add low-value tests for:

- thin Redis, R2, logger, or image-library wrappers;
- React components that only pass props into markup;
- one-off scripts with no important transformation or safety rule;
- framework routing glue with no application decision in it.

Test the rule around the dependency instead. For example, test transfer
expiry, authorization, and saved-data shape rather than re-testing the storage
SDK.

## Release checks

During implementation, run the affected Vitest file or tier. Before handing off a source change,
run `pnpm check` and tests covering the changed behavior. For example, a unit-only change may use:

```bash
pnpm check
pnpm test:unit
```

Use a focused test file when a whole tier is unnecessary. Run the full `pnpm test` suite for
cross-feature changes or release candidates.

For a release candidate or deployment, run:

```bash
pnpm verify:release
```

The release command is intentionally broader: it includes coverage, the real
browser flow, and the production build. It should be run with the same test
services that CI provides.

For a documentation-only change, verify Markdown formatting, local links, referenced paths, and
documented commands. Source tests are not required unless the audit exposes a code/configuration
mismatch. In every handoff, state what ran and what remains for CI.

## Coverage

Coverage includes application code in `lib/` and `features/`. It excludes
side-effect-only platform wrappers whose behaviour belongs to their provider:
`lib/platform/redis.server.ts`, `lib/platform/r2.server.ts`, and
`lib/platform/logger.server.ts`.

Coverage is a regression signal, not a target for artificial tests. A new
business rule should have a focused test even if the overall percentage does
not move.
