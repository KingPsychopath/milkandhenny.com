# Product direction

Milk & Henny combines writing, photo albums, games, private transfers, and event tools.
The public pages are editorial; a game board, upload, scanner, or pitch editor uses a layout suited
to its task. This document sets priorities for changes.

## Priorities

Words and Pics should leave room for reading, photographs, and captions. Use a narrow reading
measure, useful context, and little navigation furniture.

Shared games should give people a reason to talk and react together. Each personal device needs
a purpose: private information, simultaneous choices, identity, or accessibility. The
[room-first standard](room-first-multiplayer.md) describes device arrangements and attention.

Event tools should make the next action clear to a host or scanner operator. Admission needs an
understandable result and recovery on poor signal. Private sharing needs visible access rules,
expiry, progress, and interruption handling.

Preserve accepted commands, drafts, uploads, and durable work through interruption. Publish
intentionally and authorize on the server. Extend existing feature boundaries and keep each kind
of state under one owner. The [design language](design-language.md) applies these priorities to
typography, layout, controls, and motion.

## Boundaries

[`features/things/catalog.ts`](../features/things/catalog.ts) defines public Things. An internal
module or old checklist does not establish that a feature is available.

A ticket grants admission authority, not a personal account or game identity. Door actions use
request/response mutations. Shared games use realtime where another device's action changes the
current screen.

Live event scoring is retired. Historical records and operational team assignment remain;
points, leaderboards, and automatic score consumption are excluded from the current product.
See [events](events-platform.md).

Payments, external email, and the media worker need provider configuration. The local environment
supports exploration, while production delivery needs separate verification. Game tests establish
rules and recovery; first-time group playtests assess whether a mode works socially.

[Architecture](architecture.md) describes the system. [Navigation](navigation.md) covers movement
between its pages and tools.
