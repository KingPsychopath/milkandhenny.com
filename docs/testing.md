# Testing Strategy

This document explains the testing approach for Milk & Henny — what we test, why, and where each type of test lives.

The goal is **confidence without overhead**: cover the logic that would actually break the app, skip the stuff that's just glue.

---

## Test runner

[Vitest](https://vitest.dev/) — fast, native ESM, TypeScript-first, same config shape as Vite.

```bash
pnpm test          # run all tests once
pnpm test:watch    # re-run on file changes
pnpm test:coverage # run with coverage report
```

---

## Test types at a glance

| Type            | What it tests                     | Speed        | Mocks?                            | Where it lives                                                     |
| --------------- | --------------------------------- | ------------ | --------------------------------- | ------------------------------------------------------------------ |
| **Unit**        | Pure functions in isolation       | ~1ms each    | Rarely (storage/network wrappers) | `__tests__/unit/`                                                  |
| **Integration** | Multiple modules working together | ~5-70ms each | External services only (Redis)    | `__tests__/integration/`                                           |
| **E2E**         | Full user flows in a real browser | Seconds      | None                              | Skipped — see [why](#why-we-dont-have-e2e-tests-and-when-we-would) |

---

## Unit tests

**What they are:** Tests for pure functions — give input, assert output. No network, no database, no browser. They run in milliseconds and catch logic bugs instantly.

**Why they exist:** These are the highest-value tests in the project. The utility functions in `lib/` are used everywhere — words rendering, guest check-in, transfer sharing. A broken `slug()` means broken heading anchors across every words page. A broken `parseExpiry()` means transfers expire at the wrong time. Unit tests catch these regressions before they ship.

**Where they live:** `__tests__/unit/`

### What's covered

The full list lives in `__tests__/unit/`. Rather than mirror 52 filenames here (the
last attempt drifted into listing tests that no longer exist), these are the suites
worth knowing about because a failure means something specific is broken:

| Test file                      | Why it matters                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `slug.test.ts`                 | A drifted slug breaks every TOC anchor across words pages                                   |
| `ticket-qr.test.ts`            | Signature forgery and tamper rejection — the only thing between a scanner and a fake ticket |
| `event-validation.test.ts`     | Publish rules and the address-gating projection; a leak here exposes a home address         |
| `draw-country-scoring.test.ts` | Scoring fairness across every country outline (slow — has an explicit 30s timeout)          |
| `fetch-with-retry.test.ts`     | Enforces never-retry-4xx, one of the guest-list postmortem rules                            |
| `csv-parser.test.ts`           | Parses external Partiful exports, whose shape we do not control                             |

### Why these modules and not others

The rule: **test pure logic, skip glue code.**

- `slug.ts`, `format.ts`, `transfers.ts` (parseExpiry/formatDuration) — pure in, pure out. Zero dependencies. Maximum value per line of test.
- `csv-parser.ts` — parses external data (Partiful exports). CSV formats are fragile; these tests catch regressions when the CSV shape changes.
- `features/words/*` — words content is the most-used long-form feature. Reading time, heading extraction, and share access are exercised on every page load.
- `guests/types.ts` — guest ID generation feeds into every KV operation. A broken ID means orphaned data.

**What we intentionally skip:**

- `lib/platform/redis.server.ts`, `lib/platform/r2.server.ts` — thin wrappers around SDK clients. Testing them means testing the SDK, not our code.
- `lib/platform/logger.server.ts` — side-effect-only (console output). Not worth mocking.
- `lib/shared/config.ts` — reads env vars. Tested implicitly by integration tests.
- React components — these are rendering glue. The design system rules handle visual correctness. If we add component tests later, they'd use React Testing Library.

---

## Integration tests

**What they are:** Tests that exercise multiple modules working together through a real code path — but with external services (Redis, R2) replaced by their built-in fallbacks or mocks.

**Why they exist:** Unit tests prove each function works alone. Integration tests prove they work _together_. The transfer flow (generate ID → save → retrieve → validate token → delete) touches 5 functions across 2 modules. A unit test for `generateTransferId()` won't catch a bug where `saveTransfer()` serializes the data wrong. Integration tests do.

**Where they live:** `__tests__/integration/`

### What's covered

The full list lives in `__tests__/integration/`. The ones that carry real risk:

| Test file                                                                              | Flow                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ticket-issuance-redemption.test.ts`                                                   | A ticket admits exactly once under concurrent scans, and capacity cannot be oversold |
| `auth.test.ts`                                                                         | Timing-safe comparison guarding every PIN and password check                         |
| `transfers-memory.test.ts`                                                             | Full transfer lifecycle through the in-memory fallback                               |
| `heading-ids.test.ts`                                                                  | TOC and rehype-slug agree on ids, or JumpRail links scroll nowhere                   |
| `paired-game-room.test.ts`, `spelling-party-room.test.ts`, `draw-country-room.test.ts` | Multiplayer room state transitions and locking                                       |

### Why in-memory fallback, not mocked Redis

The app has a built-in `Map`-based fallback when `REDIS_REST_URL` is missing. Integration tests use this _real fallback_ instead of mocking Redis. This means:

- Tests exercise the actual production code path used in local dev
- No mock maintenance — when the transfer schema changes, no mock to update
- If the fallback ever drifts from Redis behaviour, tests catch it

The trade-off: these tests don't verify Redis-specific behaviour (TTL expiry, pipeline batching). That's acceptable — Redis is Upstash's responsibility, not ours. We test _our logic_.

---

## Where things live (directory structure)

```
__tests__/
├── unit/          # Pure logic — no I/O, mocks only for storage wrappers
└── integration/   # Multi-module flows — external services use in-memory fallbacks
```

There are currently 52 unit suites and 19 integration suites; `ls __tests__/unit` is the
source of truth rather than a list in this document, which drifted badly last time one
was kept here.

**Why `__tests__/` at the root instead of colocated?**

Colocated tests (`lib/slug.test.ts`) work well for large projects with deep nesting. This project has a flat `lib/` — putting tests next to source would double the visual noise in every directory. A single `__tests__/` tree with `unit/` and `integration/` mirrors the mental model: _what kind of test is this?_

---

## Adding new tests

### When to write a unit test

Write a unit test when you add or change a function in `lib/` that:

- Takes input and returns output (pure or near-pure)
- Is used by multiple consumers (pages, API routes, CLI)
- Has edge cases that aren't obvious (empty strings, negative numbers, malformed input)

### When to write an integration test

Write an integration test when:

- A feature involves a multi-step flow (save → retrieve → validate → delete)
- Two modules interact in a way that could break subtly (serialization, key format)
- You're testing a code path that runs differently in dev vs production (in-memory fallback vs Redis)

### When NOT to write a test

- **Rendering glue** — components that just arrange props into JSX. The design system handles visual correctness.
- **SDK wrappers** — `lib/platform/redis.server.ts`, `lib/platform/r2.server.ts`. You'd be testing the SDK, not your code.
- **One-off scripts** — CLI commands that are run manually and verified by their output.

---

## What we don't test (and why)

Not everything in the codebase needs a test. The mental model for deciding is: **what kind of code is this?**

### The three kinds of code

Every module in this project falls into one of three buckets. Only the first one is worth testing.

| Kind           | What it does                                                                                               | Example                                                                                                          | Test?   | Why                                                                                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Logic**      | Transforms data — input in, output out. Decisions, parsing, formatting, validation.                        | `slug()`, `parseExpiry()`, `parseCSV()`, `updateGuestCheckIn()`                                                  | **Yes** | A bug here silently corrupts data or breaks features. The function's contract matters and has edge cases. Tests are fast, stable, and high-value.                                                                                           |
| **Glue**       | Wires things together — passes props, calls APIs, orchestrates steps. No interesting decisions of its own. | React components, API route handlers, upload orchestration                                                       | **No**  | Testing glue means testing that you called the right function with the right args. That's verifying wiring, not behaviour. These tests are brittle (break when you refactor) and low-signal (pass even when the underlying logic is wrong). |
| **Delegation** | Thin wrapper around an external library or service. Configures and calls someone else's code.              | `lib/platform/redis.server.ts` (Upstash client), `lib/platform/r2.server.ts` (S3 client), Sharp image processing | **No**  | You'd be testing the library, not your code. If Sharp's `resize()` breaks, that's Sharp's problem. If the S3 SDK's `putObject` breaks, that's AWS's problem. Your wrapper has no logic to verify.                                           |

### Applying this to specific features

**Albums, PhotoViewer, Lightbox, MasonryGrid** — these are **glue**. They take props (photo URLs, dimensions, album metadata) and render JSX. The "logic" is CSS grid layout and event handlers (keyboard nav, swipe). The bugs you'd actually hit are visual — wrong crop, broken grid on mobile, lightbox not closing on Escape. Those are caught by the design system rules and manual testing, not by asserting that a component renders a `<div>`. If we ever needed to test these, it would be E2E (real browser, real viewport), not unit tests.

**Transfer upload flow** (`features/transfers/upload.ts`, presign/finalize routes) — this is **glue + delegation**. The flow is: call R2 for a presigned URL → return it to the client → client PUTs to R2 → call finalize → server runs Sharp. Testing it means mocking S3 presign, mocking Sharp, mocking the request/response cycle, and asserting that your orchestration called them in order. That's a test of your mock setup, not your logic. The actual data integrity (does a saved transfer come back correctly?) is already tested in `transfers-memory.test.ts`.

**Media processing** (`features/media/*.server.ts`) — this is **delegation**. These files call Sharp to resize, call S3 to upload, call fetch to download. There's no decision logic — just "take this image, resize to 600px, upload to this key." Testing it means testing Sharp and S3, which is their job.

**`features/media/file-kinds.ts`** — this is a const array and a type export. There is literally no logic to test.

**`features/media/albums.server.ts`** — this is similar to `blog` (reads JSON manifests from disk), but the data shape is simpler (no frontmatter parsing, no heading extraction, no reading time calculation). The JSON → object path is trivial. If it were doing transformations or validations on the album data, it would be worth testing.

### The mental model, summarised

> **Would a bug in this code silently produce wrong data, or would it visibly crash / look wrong?**
>
> - **Silently wrong** → test it. (`slug()` producing `"hello--world"` instead of `"hello-world"` won't crash, but every TOC link breaks.)
> - **Visibly broken** → skip it. (A broken lightbox component won't render at all — you'll see it immediately in dev.)
>
> Tests exist to catch the bugs you _wouldn't notice_. If you'd notice the bug the first time you open the page, a test adds no value.

---

## Why we don't have E2E tests (and when we would)

E2E (end-to-end) tests run in a real browser against the full running app. They're the ultimate confidence check — _does the user see what they expect?_ — but they come with real costs:

- **Slow:** A single E2E test takes 2–10 seconds (vs ~1ms for a unit test)
- **Flaky:** Timing-dependent — a slow CI runner or a CSS animation can cause false failures
- **Expensive to maintain:** Tests break when a class name, layout, or selector changes, even if the feature still works
- **Require infrastructure:** A running dev server, browser binaries, CI config, screenshot storage

### Status: the trigger has fired

This section used to say E2E was unnecessary because the blast radius of a bug was
"an awkward moment at a party." That is no longer true. The events platform issues
tickets, gates a home address on ticket ownership, and will take card payments in
Phase 2. The first trigger listed below — paid events — is now live.

E2E tests are still absent, which is a **known gap, not a considered decision**. The
door flow is covered at the integration level (`ticket-issuance-redemption.test.ts`
proves single admission under concurrent scans and no overselling), but nothing
exercises a real camera, a real offline transition, or a real payment redirect.

Until that gap is closed, the rehearsal checklist in
[`events-platform.md`](./events-platform.md) is the compensating control, and it is
not optional before an event that matters.

### When E2E would be worth adding

Add E2E tests (with [Playwright](https://playwright.dev/)) if any of these become true:

- **Paid events** — ✅ fired. Ticketing exists; Stripe checkout lands in Phase 2.
- **User accounts / payment** — auth flows with OAuth, session tokens, and payment forms have enough moving parts that browser-level testing catches real bugs unit tests can't
- **Complex upload flows** — if the web upload UI grows beyond the current presign → PUT → finalize pipeline into a multi-step wizard with progress, retries, and error recovery
- **Multiple contributors** — if other people start shipping code and you can't manually verify every change

**Where they'd live:** `__tests__/e2e/` — same tree, new directory. Separate Playwright config, separate CI step. The tool is Playwright (not Cypress, not Vitest browser mode) because it supports Chromium, Firefox, and WebKit with the best API for testing real navigation.

**What they'd cover (when the time comes):**

- Door: staff PIN → scan a QR → admitted → scan again → already-redeemed → drop the network → scan → queued and synced
- Transfer: share link → preview gallery → download → countdown timer accuracy
- Words: navigate to a page → click TOC heading → verify scroll position

---

## Configuration

**`vitest.config.ts`** at the project root:

- Path aliases (`@/` → project root) match `tsconfig.json`
- Node environment (no jsdom needed — we're testing server logic)
- Coverage covers `lib/**` and `features/**`
- Excludes `redis.ts`, `r2.ts`, `logger.ts` from coverage (note: these exclude patterns predate the `.server.ts` rename and no longer match — see `vitest.config.ts`) (SDK wrappers / side-effect-only)

**`package.json` scripts:**

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```
