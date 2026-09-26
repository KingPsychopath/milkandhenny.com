# Server state and data loading proposal

Status: implementation in progress on `codex/tanstack-query-architecture`.
Prepared: 2026-09-26.
Implementation base: `f2bfadb810ba354bc39713c355e49335bab87c36` from `main`, in a separate
managed worktree. The active `main` checkout has unrelated uncommitted storage work.

## Decision

Use TanStack Query as the standard owner of ordinary remote data in the browser, integrated with
TanStack Start and Router once at the application root. Loaders coordinate navigation, authorization
gates, initial server rendering, and preloading. Components observe the same queries. Feature
commands define which cached views change after a successful mutation.

Retain the modular monolith, feature workflows, pure policies, and selective backend Effect
orchestration. Live rooms, offline drafts, upload execution, and local games retain explicit domain
controllers. The target gives every kind of state a clear owner throughout the application.

The existing [Postgres migration plan](../plan.md) owns persistence replacement. Its target is
Postgres for authoritative application records and durable work, and object storage for binaries.
That migration is in progress; the running architecture still includes Redis. Query adoption can
use stable feature contracts independently of the storage migration.

## Requirements and constraints

- Render initial critical content on the server, then reuse its data in the browser.
- Share equivalent remote reads across routes and components; refresh only affected resources.
- Avoid initial component-effect fetch waterfalls and duplicate reads during hydration.
- Keep first render, navigation, preloading, refresh, mutation, and reconnect behavior consistent.
- Stream independent secondary content when it improves a measured user journey.
- Preserve authorization, expiry, private-view isolation, command idempotency, and durable recovery.
- Preserve accessible pending/error states, deep links, browser history, CLI parity, and offline use.
- Prefer one domain owner over duplicate snapshots in loaders, component state, and a query cache.

This is a design proposal, not a claim that every existing component has been audited or that a
specific performance gain has been measured. Repository searches and representative source traces
support the inventory below. Production latency and request budgets remain to be measured.

## Current implementation

| Area                 | Evidence                                                                                                                                                                                         | Current behavior and consequence                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router               | [router](../src/router.tsx), [dependencies](../package.json)                                                                                                                                     | Router cache, intent preloading, 30-second preload freshness, immediate ordinary staleness. No Query dependency or SSR Query integration.                                                                                  |
| Public pages         | [home](../src/routes/index.tsx), [event route](../src/routes/events/$slug.tsx)                                                                                                                   | Isomorphic loaders call server functions and components read `useLoaderData`. This is a valid SSR foundation. Returned server-function promises are awaited before route data is ready.                                    |
| Composite event read | [event page workflow](../features/event-operations/event-page.server.ts)                                                                                                                         | Event, ticket availability, images, and optional pitch showcase become one loader result. Internal parallel reads still wait for the whole result.                                                                         |
| Admin                | [dashboard](../features/admin/ui/AdminDashboard.tsx), [communications](../features/admin/ui/components/CommunicationsPanel.tsx), [session hook](../features/admin/ui/hooks/useTokenSessions.ts)  | Mix of loader bootstrap, effect-driven API reads, manually maintained remote state, refresh callbacks, and mutation status. Communications already receives initial route data; several other panels fetch after mounting. |
| Account              | [account route](../src/routes/my.tsx), [account page](../features/attendee-access/ui/MyAccountPage.tsx)                                                                                          | SSR bootstrap copied into component state, with manual mutation patches and route invalidation for identity changes.                                                                                                       |
| Transfers            | [transfer route](../src/routes/t/$id.tsx), [gallery](../features/transfers/ui/transfer/TransferGallery.tsx), [media events](../features/transfers/ui/transfer/useTransferMediaEvents.ts)         | Loader data copied into local file/group state; SSE patches that state; some mutations invalidate the router. Download progress and selection are also local state, with different ownership needs.                        |
| Refresh scheduling   | [admin refresh](../features/admin/ui/hooks/useAdminAutoRefresh.ts), [visibility reconciler](../hooks/useVisibilityReconciler.ts)                                                                 | Shared visibility, reconnect, coalescing, and minimum-gap policy already exists. Query adoption must preserve these policies.                                                                                              |
| Multiplayer          | [live snapshots](../features/things/shared/useLiveRoomSnapshot.ts), [room reconciler](../features/things/shared/useRoomReconciler.ts)                                                            | Sequence/digest checks, server-clock correction, phase boundaries, socket wakes, and safety polling form a domain protocol.                                                                                                |
| Offline work         | [offline storage](../features/offline/storage.ts), [upload recovery](../features/transfers/ui/upload/recovery.ts), [pitch controller](../features/things/pitches/ui/usePitchEditorController.ts) | Browser recovery and working copies have their own persistence and lifecycle.                                                                                                                                              |
| Browser-only routes  | [pitch demo](../src/routes/things.pitches_.demo.tsx), [pitch editor route](../src/routes/things.pitches_.$deckId_.edit.tsx)                                                                      | `ssr: false` skips their loaders during the server request even though these particular loaders call server functions. Evaluate `ssr: "data-only"` for this case.                                                          |

There is no application use of Query prefetch/hydration or deferred loader data rendering in the
inspected route tree. Existing React lazy/Suspense boundaries and live SSE/WebSocket connections
serve different purposes from streaming initial query results.

## Target ownership

| Kind of state or work                     | Owner                                                                 | Examples                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Durable truth                             | Feature workflows and Postgres transactions; object storage for bytes | Tickets, content, transfer metadata, rooms, permissions, outboxes                                         |
| Route identity and navigation             | TanStack Router                                                       | Resource IDs, validated search filters, pagination, redirects, status and head metadata                   |
| Ordinary remote snapshots                 | TanStack Query                                                        | Event views, account/tickets, admin lists, communications, album/transfer metadata, processing-job status |
| Ordinary request mutation status          | Query mutation plus a feature command                                 | Pending/error/result, exact cache updates and invalidation                                                |
| Form working copy                         | Local form state with a base revision                                 | Unsaved event edits, recipients, captions; new server snapshots must not erase dirty fields               |
| Live room projection and command protocol | Room controller/reconciler                                            | Sequence ordering, viewer redaction, clock offsets, commands, acknowledgements, reconnect                 |
| Offline working copy and recovery         | Domain controller plus versioned browser storage                      | Pitch editing, local games, recoverable uploads                                                           |
| Transient interaction                     | React state/reducers                                                  | Menus, selections, animation, timers, input, file progress                                                |
| Backend side-effect orchestration         | Existing subsystem Effect runtimes where justified                    | Worker lifecycle, bounded concurrency, deadlines, retries, external mutations                             |
| Public asset delivery                     | Object storage/CDN and HTTP cache policy                              | Versioned images, audio, JS and downloads                                                                 |

```text
URL / navigation
  -> route loader (server for initial load; browser for navigation)
       -> feature query options -> request-scoped SSR / browser QueryClient
            -> TanStack server function or shared HTTP contract
                 -> feature workflow / pure policy
                      -> repositories, providers, transactions and outboxes

React components <- observe the same QueryClient
Mutation -> authorized feature command -> confirmed result -> targeted cache update/invalidation
Media event -> feature event adapter -> revision check -> Query update or invalidation
Room event -> room reconciler -> ordered room projection -> room UI
```

The browser cache is disposable. It improves navigation and consistency between views; it does not
decide authorization or prove a purchase, admission, or remote write succeeded.

## Changes by layer

### Router and rendering

- Create one QueryClient inside `getRouter`: one per SSR request and one retained by the browser
  router. Add typed root context and the official SSR integration. Select compatible dependency
  versions against the installed Start/Router packages during implementation.
- Let Query decide freshness for Query-backed loaders. The integration uses
  `defaultPreloadStaleTime: 0`; account for existing Router-only routes while migrating.
- Await critical reads. Start independent reads together. Retain existence, authorization,
  redirects, status, title, main content, and primary imagery in the critical path.
- Start independent secondary queries early and render them inside useful Suspense/error
  boundaries. A below-fold pitch showcase is a candidate after its actual layout is verified.
- Components subscribe to query data instead of copying a loader DTO into `useState`. Loaders
  return only necessary route/head metadata for migrated resources. When a mutation changes that
  metadata, refresh its route too; a Query invalidation alone does not update `head` loader data.
- Use normal `useQuery` for conditional, browser-identity-dependent, or cancellation-sensitive
  reads. Use suspenseful queries deliberately for rendering boundaries. Current official
  `useSuspenseQuery` documentation lists a cancellation limitation; do not assume every abandoned
  suspense read stops its server work.
- Organize admin loading around independently navigable workspaces. The active workspace owns
  its initial queries, while its shared layout preloads only shared necessities. Existing deep
  links can map to those boundaries without preloading all panels.
- Keep SSR for everything that can render on the server, with narrow `ClientOnly` sections when
  necessary. Use `ssr: "data-only"` where the whole route needs browser APIs but its data is
  available on the server. Retain `ssr: false` for actual browser-only loader inputs and
  intentionally local games. Static pages and bundled game data need no remote query.

### Feature queries and commands

Add small feature-owned query option/key modules and mutation hooks where they have consumers.
For example, an event feature can expose `events.queries.ts` and focused UI mutation hooks beside
its existing `events.functions.ts` and server workflows. Shared application code owns QueryClient
creation, transport-error conventions, and session-cache reset. Avoid a generic CRUD framework or
one global file containing every feature's keys and invalidation rules.

Each read specifies its inputs, view/access scope, DTO, freshness, error policy, and refresh policy.
Keys include all result-changing inputs: resource identity, projection, pagination/filter values,
and a non-secret viewer/access scope when personalized. Public, attendee, staff, and admin
representations must not share an entry just because their resource ID matches. Credentials stay
in the established auth transport. Capability-backed views need explicit scope/expiry/reset rules
before enabling reuse. Keys are cache identity, never authorization evidence.

Query caches query results rather than automatically normalizing every entity. Reuse identical
read contracts across routes. Split data when permission, lifetime, invalidation, or rendering
timing differs. Keep cohesive server read models when they avoid a waterfall or provide a
consistent aggregate; do not turn each database table into a browser request.

The server function/HTTP adapter converts expected domain failure results into a consistent
client failure contract. A resolved `{ ok: false }` must not silently count as a successful Query
mutation. Preserve field errors, permission/expiry failures, conflicts, retryability, and uncertain
write outcomes. Translate once; keep product decisions in server workflows.

Transport reads consume cancellation signals where supported; server workflows retain request
cancellation and deadlines. Superseded responses must never cross resource/viewer identities.
Cancellation of a request is not proof that an external write was rolled back.

### Mutation and refresh policy

Feature mutation hooks own an explicit list of affected query families. A confirmed response can
replace an exact complete cache entry; lists, counts, or related read models are invalidated.
Await the refresh when the next user action depends on seeing the committed result. Keep existing
data visible during background refresh where it remains useful, and surface refresh failure.

For example, changing an attendee ticket may affect the ticket detail, that attendee's ticket
list, and the event's availability. It does not need to reload albums or every admin panel.
Publishing a word affects its reader view, content lists, and the home feed; public HTTP/CDN
invalidation remains a separate publication responsibility.

Use optimistic UI for reversible changes with cancellation, rollback, and conflict reconciliation.
Admission, payment, refund, and other consequential commands display confirmed or uncertain
outcomes until the server resolves them. Query mutation state lasts for a request; a queued media
job has a durable ID and separately observed lifecycle. Keep stable idempotency keys at the
domain boundary for commands that may be retried.

Use resource-specific freshness. Editorial data can tolerate longer reuse; inventory and
operations views need shorter windows or explicit wakes. Authoritative mutations always recheck
the database. Do not pick one global duration as a correctness mechanism.

Bound safe read retries and exclude automatic 4xx retries under the repository contract. Avoid
stacking client and backend retries into an uncontrolled multiplier. Mutation retries remain off
unless the domain guarantees idempotency. Query's focus/reconnect/interval defaults require
deliberate configuration: an interval alone does not enforce a hard minimum fetch gap across all
triggers. Retain a small refresh scheduler for surfaces requiring coalescing/cooldowns, with Query
as the snapshot owner and one scheduling owner per resource.

### Authentication, realtime, and offline behavior

Route context carries the minimal viewer summary needed for navigation. Every private server read
and command authorizes independently. Identity changes cancel/remove the old scope's private
queries, clear relevant route state, and resolve the next context before exposing private views.
Late responses and mounted old-view observers must not repopulate the new scope. Session expiry
and permission changes need the same explicit transition.

SSR isolation and HTTP caching are separate requirements. Personalized HTML and data responses
remain private. Dehydrated data is visible to the browser, so return only its permitted view.
Browser query persistence is opt-in per domain; existing local recovery does not justify persisting
all private data or mutation variables.

Transfer processing events feed the transfer query through a feature adapter, with revision or
processing-generation checks and snapshot reconciliation on reconnect. Query does not supply an
SSE/WebSocket protocol or automatically synchronize different users and tabs. Wakes remain
advisory; missed delivery is repaired by authoritative reads.

Live rooms retain one sequence-aware projection owner. Their ordering, digest, clock, readiness,
and command-recovery semantics stay in the room protocol. Query can own independent room listings
or setup metadata. Avoid also placing the active room snapshot in a second mutable cache. A future
Query-based room implementation would first need to reproduce the complete protocol contract.

Upload bytes, resumable tasks, download streams, and browser file handles stay in dedicated
controllers. Query observes their server metadata. Pitch/editor drafts retain local revisions,
autosave serialization, conflicts, and recovery; Query observes saved remote versions. LocalStorage
or IndexedDB inputs can legitimately require a client-only read after SSR, as with a remembered
poll voter. Such reads should be explicitly enabled when that identity becomes available.

### Backend and operations

Keep feature policies, transactions, provider adapters, durable jobs/outboxes, and the existing
Effect runtime ownership. Query changes how the UI consumes server state; those backend contracts
remain necessary. Use plain TypeScript for pure rules and simple data access, and Effect for
workflows that need its execution/lifecycle guarantees.

Prefer typed Start server functions for application-internal reads and commands. Keep HTTP
contracts for CLI consumers, integrations, webhooks, downloads/uploads, and streaming transports.
Both entry points call the same feature workflow; SSR should not make a network request to its
own public API just to reuse business logic. Existing dual-consumer HTTP endpoints can be used by
Query while their server-function adapter shares the same domain operation. Inventory consumers
before retiring a route.

Keep the web process and independently scalable media-worker role. Query adoption supplies no
reason to split the modular monolith into services or add another backend RPC framework. The
storage migration remains governed by its own data integrity, cutover, and operational checks.

## Proposed implementation milestones

These are implementation milestones. The foundation and poll slice are implemented; broader M1
acceptance evidence and later slices remain open.

| Milestone                             | Outcome                                                                                                                      | Dependencies and acceptance                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1: Foundation and one complete slice | QueryClient/SSR integration, typed keys, failure conventions, auth reset, and the public poll read/vote slice                | Confirm package compatibility. Prove SSR content, isolated concurrent requests, no duplicate fresh hydration read, cache reuse, targeted invalidation, and auth reset. |
| M2: Admin workspaces                  | Move dashboard, communications, operational lists and session views to query ownership; remove redundant fetch/loading state | M1. Preserve CLI/HTTP contracts, step-up, filters, partial failures and bounded refresh. Load active workspace from its route boundary.                                |
| M3: Public and attendee resources     | Consistent queries for events, words, albums, pitches, polls, tickets and account views                                      | M1. Distinguish public/private scopes, preserve metadata/status/expiry and browser-only identities; use measured streaming candidates.                                 |
| M4: Transfers and editor integration  | One remote metadata owner; event-to-query bridge; drafts and file execution stay in controllers                              | M1 and relevant metadata contracts. Prove reconnect reconciliation, monotonic processing updates, deletion, expiry, dirty-draft survival and recovery.                 |
| M5: Protocol and repository cleanup   | Classify remaining remote reads; retain explicit room/local owners; remove migrated obsolete hooks and duplicate snapshots   | M2-M4. No unexplained initial effect fetches or unowned refresh loops; document justified exceptions and update normative architecture rules.                          |
| M6: Integrated verification           | Evidence for the complete target across feature journeys                                                                     | All milestones. Run the repository release verification and the acceptance scenarios below; compare performance with the recorded baseline.                            |

Each slice should include its read, component subscription, mutation, invalidation, errors, identity
transition, and obsolete-code removal in coherent commits. Parallel storage work is coordinated
through stable DTOs and feature boundaries; do not mix unrelated database edits into Query commits.

## Acceptance checks

1. Direct SSR contains critical content and metadata; hydration makes no duplicate read while fresh.
2. Concurrent SSR requests with different identities never exchange data, even for similar keys.
3. Navigation/preload to a second consumer reuses the appropriate fresh query; changed filters use
   distinct entries. Test stale reuse and forced-fresh behavior separately.
4. Mutation updates/refetches only the intended views, including list/detail/count relationships;
   any changed route metadata also refreshes. Failure and uncertain completion remain visible.
5. Sign-out, account switch, capability expiry, and permission loss cannot display/repopulate an
   old private scope, including delayed responses and browser Back/Forward.
6. Delaying a secondary query does not delay critical HTML; its failure remains local to its
   boundary. Measure streaming through the actual deployment proxy as well as local development.
7. Reconnect/wake/focus storms preserve minimum fetch gaps, bounded retries, and one refresh owner.
8. Old media/room responses cannot roll back newer state; loss of a wake is recoverable.
9. Draft edits, local games, upload recovery, and any authorized offline command journal survive
   the same refresh/disconnect cases as before.
10. Record request counts, bytes, server latency, TTFB/LCP, and first-interaction readiness for
    representative cold loads, warm navigation, and mutations. Query adoption alone is not proof
    of faster pages or lower database load.

Use narrow tests during each slice, `pnpm check` for source changes, relevant browser journeys,
and `pnpm build` for the SSR/client boundary. Cross-feature integration needs the full test suite;
the release candidate uses `pnpm verify:release` under the repository verification contract.

## Checkpoint

- Completed: source inventory, target ownership, replacement decisions, implementation milestones,
  and acceptance checks; corrected the React rule's description of isomorphic loader execution.
  Created an isolated worktree and branch at the recorded `main` base. Selected polls for M1
  because its SSR read, browser-local voter identity, and vote mutation cover the full query
  lifecycle without mixing into the concurrent storage migration.
- Application implementation: QueryClient is created per router, integrated with Start SSR, and
  passed through typed route context. The poll route now seeds and observes one public Query entry;
  its browser-only voter lookup, vote mutation, and public result invalidation use feature queries.
  Identity transitions cancel/clear Query snapshots with Router state. Unmigrated loaders keep the
  existing Router preload policy; migrated routes opt into Query freshness. Public home, words,
  albums, and events listings, the event detail read, and the attendee account/security summary now
  use feature-owned queries. Public listings no longer serialize the same DTO in loader output and
  the Query cache. The event loader retains only head metadata. The account view is a single private
  Query entry, with local form drafts and recovery codes kept outside it.
- Admin progress: the content summary and system health read models now live in feature workflows
  shared by their existing HTTP endpoints and new server functions. The overview and system routes
  seed their private Query entries on the server. AdminDashboard observes those entries instead of
  fetching and copying both snapshots after mount. The existing visibility scheduler still controls
  system checks, including a hard minimum gap and a stop on 4xx; confirmed content edits invalidate
  their admin summary and the affected public listing families. The operations inbox now has a
  shared feature read, a streamed private Query snapshot, and a Query-backed notification summary;
  its bounded refresh scheduler and 4xx stop remain in place. The communications workspace now
  prefetches its exact tab/event query on the server, and its panel observes one Query-owned snapshot
  instead of copying contacts, plans, messages, templates, surveys, and email status into local
  state. Search is keyed separately; composition and editor drafts remain local. Other admin panels
  remain to migrate.
- Album detail: the album and photo routes reuse a single hydrated album query. Their loaders retain
  only head metadata and photo existence checks. Admin content edits invalidate the entire public
  album query family.
- Word detail: public and unlisted readers now reuse a hydrated detail query, with head metadata
  retained in the loader. A share parameter still passes through the server before cache seeding so
  private words redirect to the vault with their capability token. Content edits invalidate the
  public word query family.
- Session security: the token session HTTP endpoint and new server function call one feature read
  workflow. The system route hydrates the private session query, and its hook keeps only local
  filter/paging state. Single-session revocation refetches; global revocation reloads the auth gate.
- Verification: `pnpm check`, `pnpm build`, the full Vitest suite (275 files, 2,107 tests) with
  four workers, QueryClient isolation and identity-reset unit tests, and focused public, event,
  account, poll, and admin Playwright journeys passed. The browser journeys proved SSR content,
  poll vote submission and restored device view, account sign-out isolation, and admin overview
  content/system hydration and the inbox badge/popover with a seeded notification. The full suite
  and production build passed again after the inbox change. The Playwright app now uses the Postgres album store, since its S3 stub
  does not serve album manifests. The default 20-worker Vitest run stalled behind database lock
  contention and was replaced by the passing capped run. The final build and focused admin browser
  rerun passed after the 4xx polling adjustment.
- Recent verification: `pnpm check` and `pnpm build` passed after the communications and album
  changes. Focused communications and album integration tests passed against a task-isolated local
  PostgreSQL database. Five communications/public Playwright journeys and one seeded album/photo
  journey passed against that database and task-isolated Redis. The first browser attempt timed out
  while the shared container runtime was unavailable; isolated services resolved it. The full
  Vitest suite was last run before these two slices; final cross-feature verification remains due.
- Word and session verification: `pnpm check`, production builds, the private-token integration
  test, and focused word/share and session browser journeys passed. The Playwright server now uses
  the Postgres word store by default so its seeded word detail journey also passes without a
  special environment override. A full Vitest run against the isolated database is in progress.
- Open: explicit concurrent-identity SSR and hydration request-count evidence; measured workload
  and freshness budgets; full endpoint-consumer inventory; capability-view cache scopes; and
  per-feature invalidation relationships. M1 implementation is a foundation, not full M1
  acceptance closure.
- Next action: migrate remaining public and admin resource families, then design the transfer
  capability scope and event reconciliation before moving its metadata into Query. Classify the
  remaining loaders against the target ownership table, revisit M1 acceptance checks, and run
  integrated verification before declaring completion.
- Commit record: `aba7708d` proposed the architecture on `main`; `5c6415c1` opened the worktree
  implementation plan; `9141051c` integrated Query SSR, the poll slice, and identity cache reset;
  `50dfb9a3` recorded that milestone; `ae1812aa` migrated public and attendee views; `ef14de0d`
  recorded that checkpoint; `0dc90b31` hydrated admin content and system snapshots; `60c85235`
  recorded that checkpoint; `ba41fc9c` hydrated the operations inbox; `ab255a88` recorded its
  checkpoint; `cb2815b7` migrated communications; `f1a7a634` shared album detail; `087a05d8`
  added the album browser journey; `94aa4cea` hydrated public word detail; `2174a3ce` hydrated
  token sessions.

## References

Repository contracts: [architecture](./architecture.md), [Effect lifecycle](./effect-lifecycle.md),
[durable work](./durable-work.md), [navigation](./navigation.md), and
[CLI parity](../.cursor/rules/cli-parity.mdc).

Official documentation consulted on the preparation date:

- [Start execution model](https://tanstack.com/start/latest/docs/framework/react/guide/execution-model)
- [Start and Query](https://tanstack.com/start/latest/docs/framework/react/guide/tanstack-query)
- [Router SSR Query integration](https://tanstack.com/router/latest/docs/integrations/query)
- [Query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
- [Suspense query behavior](https://tanstack.com/query/latest/docs/framework/react/reference/functions/useSuspenseQuery)
- [Selective SSR](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr)
