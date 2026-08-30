# Agent Instructions

Instructions for AI coding agents working in this repository. Applies to Claude Code, Codex, Cursor, and anything else driving edits here.

The previous version of this file described a Codex-specific checkpoint protocol and token-economy rules. Those described a way of talking, not this codebase. What follows is what an agent actually needs to know to change this repo without breaking it.

---

## 1. What this is

A TanStack Start + Nitro application served as a plain Node server. Writing, photo galleries, party games, private file transfers, and events/ticketing.

It is a **modular monolith**, deliberately provider-neutral: it runs from the included Dockerfile on Railway, a VPS, or anywhere else that supplies a port and environment variables. No hosting-provider APIs are imported by application code.

Read [`docs/architecture.md`](./docs/architecture.md) before making structural changes. Read
[`docs/room-first-multiplayer.md`](./docs/room-first-multiplayer.md) before creating or materially
changing a co-located multiplayer mode.

---

## 2. Toolchain

| Concern    | Tool                                  | Command             |
| ---------- | ------------------------------------- | ------------------- |
| Package    | pnpm 11.17.0 (`packageManager` field) | `pnpm install`      |
| Types      | TypeScript 7 native preview (`tsgo`)  | `pnpm typecheck`    |
| Lint       | Oxlint                                | `pnpm lint`         |
| Format     | Oxfmt                                 | `pnpm format`       |
| Tests      | Vitest                                | `pnpm test`         |

**ESLint and Prettier are intentionally absent.** Do not add them, and do not add config files for them.

Node 22+. Before claiming a change is finished, `pnpm typecheck`, `pnpm lint` and `pnpm test` must all pass.

---

## 3. Layer ownership

This is the rule that matters most. From `docs/architecture.md`:

| Layer                       | Owns                                                                |
| --------------------------- | ------------------------------------------------------------------- |
| `src/routes`                | Routing, transport validation, response shape, coarse authorization |
| `features/*/*.functions.ts` | TanStack server-function boundaries                                 |
| `features/*/*.server.ts`    | Feature workflows and durable product rules                         |
| `features/*/ui`             | User interaction and rendering                                      |
| `lib/platform`              | Redis, object storage, email, logging, provider translation         |
| `lib/shared`                | Environment-safe shared constants and pure utilities                |

**Routes do not own business truth.** A route reads input, checks auth coarsely, calls a feature, and shapes a response. If you find yourself writing an `if` about what a user is allowed to do inside `src/routes`, it belongs in a `.server.ts`.

Anything importing `node:crypto`, `process.env` secrets, or a platform adapter must live in a `.server.ts` file. `lib/shared` and feature `types.ts` files are imported by the browser — keep them pure.

---

## 4. Effect

Effect v4 is used at **service boundaries**, not as a general programming style.

The established pattern, visible in `features/things/shared` and `features/events`:

- Engines stay **plain async functions** in `*.server.ts`. They own the product rules.
- A `Context.Service` + `Layer` wraps those engines to add timeout, typed errors (`Data.TaggedError`), structured logging, and spans.
- One `ManagedRuntime` per subsystem, disposed by a Nitro `close` hook in `server/plugins/`.
- Promise conversion happens **only** at TanStack/Nitro edges.

Do not rewrite data access into Effect pipelines. Do not import Effect into browser code, React components, reducers, or offline game logic.

Effect is pinned to an exact prerelease (`4.0.0-beta.99`). Treat a version bump as a coordinated change, not a routine upgrade.

---

## 5. Persistence rules

Redis is the source of truth for mutable state. Object storage holds media and transfers.

**One key per record.** Do not put a collection in a single key. This is not a style preference — see [`docs/postmortem-guestlist-kv-read-spike.md`](./docs/postmortem-guestlist-kv-read-spike.md), where a single `guest:list` key plus a re-rendering poll loop nearly exhausted a daily KV quota from one browser tab.

The client-side rules that came out of that incident apply to any polling UI:

- Ref-stable callbacks, so a parent re-render cannot restart a polling effect.
- A hard minimum fetch gap, independent of the intended poll rate.
- **Never retry 4xx.** Only network errors and 5xx.

Production fails closed when required persistence is unavailable. In-memory fallbacks exist for local development and tests only, and must be guarded by a `NODE_ENV` check.

---

## 6. Design language

Read [`docs/design-language.md`](./docs/design-language.md) before touching UI.

The short version: warm stone palette, serif (Lora) for prose, mono (Geist Mono) for UI chrome, amber as the single accent used sparingly. Single column, `max-w-2xl`, `px-6`. Hairline dividers, not boxes. Hover is opacity, not colour flips.

**No hardcoded hex in components.** Use the theme tokens and the `theme-muted` / `theme-subtle` / `theme-border` utilities. If you need a new colour, add a token to `src/styles/globals.css` in both light and dark.

Never create a utility class that collides with a Tailwind name (the codebase has `anim-duration-300` precisely because `duration-300` is Tailwind's).

---

## 7. Detailed rules

`.cursor/rules/` holds deeper per-domain rules. Load them when the task calls for it, not by default:

| Task domain                                     | File                                |
| ----------------------------------------------- | ----------------------------------- |
| UI, design, CSS, components                     | `.cursor/rules/design-system.mdc`   |
| Accessibility, semantic HTML, forms, focus      | `.cursor/rules/accessibility.mdc`   |
| React, routing, server/client boundaries        | `.cursor/rules/react-nextjs.mdc`    |
| CLI commands, domain scripts, admin tools       | `.cursor/rules/cli-parity.mdc`      |
| File moves, renames, codemods                   | `.cursor/rules/file-ops.mdc`        |
| TypeScript, safety, module boundaries           | `.cursor/rules/engineering-core.mdc`|
| Testing strategy                                | `.cursor/rules/testing.mdc`         |
| Co-located multiplayer, game fun, device balance | `docs/room-first-multiplayer.md`    |
| Multiplayer scenarios, dev harnesses, solo QA    | `docs/multiplayer-testing.md`       |

Note that `react-nextjs.mdc` is named for a framework this project no longer uses; the React and boundary guidance in it still applies.

---

## 8. Working style

- Read before writing. This codebase has strong existing conventions; match the neighbouring file rather than importing habits from elsewhere.
- Prefer extending a feature module over growing `features/admin/ui/AdminDashboard.tsx`, which is already ~2,300 lines. New admin surfaces go in `features/admin/ui/components/` as self-contained panels taking `authFetch` / `onError` / `onStatus`.
- Comments explain **why**, not what. Do not narrate the code.
- Conventional Commits for commit messages.
- If a plan document is attached, follow it; if you disagree with it, say so once and then either follow it or ask — do not silently diverge.
