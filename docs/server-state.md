# Server state and browser data

TanStack Query owns ordinary remote snapshots. Router owns navigation and initial loading.
Feature workflows and durable stores own truth. Domain controllers own live protocols and recovery.

## Ownership

| State                                                                      | Owner                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------ |
| Resource identity, validated filters, pagination, redirects, head metadata | TanStack Router                                  |
| Ordinary remote snapshots                                                  | Feature query options and TanStack Query         |
| Pending command, confirmed result, affected views                          | Feature command / mutation hook                  |
| Unsaved form fields                                                        | Local working copy with its base revision        |
| Ordered live room projection and reconnect protocol                        | Room controller / reconciler                     |
| Upload execution and interrupted upload recovery                           | Transfer controller and versioned tab checkpoint |
| Offline games and pitch editing                                            | Domain controller and versioned browser storage  |
| Menus, selection, animation, input                                         | React state / reducer                            |
| Authorization and accepted writes                                          | Server workflow and authoritative persistence    |

## Loading

[`src/router.tsx`](../src/router.tsx) creates a QueryClient with each router and installs SSR Query
integration. Server requests therefore have isolated caches; the browser retains its router cache.

A Query-backed loader prefetches critical data. Its component observes the same query instead of
copying a DTO into `useState`. Query-backed routes set `preloadStaleTime: 0` so Query owns freshness;
Router-only loaders retain the router's own preload policy. Await existence, authorization,
redirect, and primary content requirements. Independent secondary reads can start early behind
useful Suspense and error boundaries.

Query keys include every input that changes the view, including non-secret access scope.
Credentials never belong in keys, logs, or dehydrated shared snapshots. Every server read authorizes
independently. A capability URL can use a route-local loader with zero Router cache lifetime.

## Commands and refresh

After a confirmed command, update a complete exact cache entry or invalidate the affected feature
families. Refresh route data too when a mutation changes loader-owned head metadata. Keep server
snapshots separate from dirty form drafts; a background refresh must not erase unsaved work.

The browser cache is disposable. A success redirect, notification, or optimistic patch cannot
establish payment, admission, or durable mutation success. Reconcile uncertain outcomes against
server state before retrying.

Polling and refresh callbacks must be ref-stable, cancellable, and subject to a hard minimum fetch
gap. Avoid automatic retries for 4xx failures. Visibility and reconnect refreshes use the shared
reconciliation policy rather than independent component timers.

## Specialized state

Live rooms require ordering, redaction, clock correction, action acknowledgement, and reconnect
reconciliation. Their controller owns that protocol; Query can own independent room metadata.
Media events pass through feature revision checks before updating or invalidating metadata queries.

Offline drafts, local games, and interrupted uploads have versioned recovery records. Their
controllers validate and reconcile those records rather than treating them as server truth.
Cookies, browser storage, and access rules are covered in [storage and auth](storage-and-auth.md).
Browser history and addressable resources are covered in [navigation](navigation.md).

The original refactor proposal and verification diary are retained as
[historical evidence](https://github.com/machineyearningengineer/milkandhenny.com/blob/b283af0b19bd581f65cacd7bb52dff4982c90b57/docs/archive/server-state-architecture-proposal.md).
