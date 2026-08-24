# Testing

The test suite protects product decisions and data integrity. It does not try to
assert every React wrapper or third-party SDK call.

## Commands

| Command                 | Use                                                   | Needs services                        |
| ----------------------- | ----------------------------------------------------- | ------------------------------------- |
| `pnpm check`            | Format, type, and lint checks                         | No                                    |
| `pnpm test:unit`        | Fast pure-logic tests                                 | No                                    |
| `pnpm test:integration` | Multi-module and persistence flows                    | Some suites use Postgres              |
| `pnpm test`             | All Vitest tests                                      | Postgres suites skip without Postgres |
| `pnpm test:coverage`    | All Vitest tests with the release coverage gate       | Postgres suites skip without Postgres |
| `pnpm test:e2e`         | Browser-level pitch flow in `e2e/pitch-night.spec.ts` | Postgres, S3 test server, Chromium    |
| `pnpm verify:release`   | Full local release gate                               | Postgres, S3 test server, Chromium    |

CI provides Postgres, installs Chromium, runs the full coverage suite, runs the
browser flow, and builds the production bundle. A local Vitest run probes
Postgres once. Database-backed suites are skipped with a clear warning when it
is not available; CI must remain the place that proves those suites ran.

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

### Browser tests

Browser tests live in `e2e/` and use Playwright. Keep these flows few and
high-value because they are slower and more sensitive to infrastructure. The
current flow covers creating, saving, publishing, presenting, and remotely
controlling a pitch, including admin unlock.

Add a browser test when a failure would be hard to see from server tests alone:

- a critical navigation or authentication flow;
- a payment, ticket, or staff operation;
- a multi-step interaction where browser state matters;
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

For a normal source change, run:

```bash
pnpm check
pnpm test
```

For a release candidate or deployment, run:

```bash
pnpm verify:release
```

The release command is intentionally broader: it includes coverage, the real
browser flow, and the production build. It should be run with the same test
services that CI provides.

## Coverage

Coverage includes application code in `lib/` and `features/`. It excludes
side-effect-only platform wrappers whose behaviour belongs to their provider:
`lib/platform/redis.server.ts`, `lib/platform/r2.server.ts`, and
`lib/platform/logger.server.ts`.

Coverage is a regression signal, not a target for artificial tests. A new
business rule should have a focused test even if the overall percentage does
not move.
