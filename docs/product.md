# Product direction

Milk & Henny brings writing, pictures, play, and gatherings into one place. Its public face is
quiet and editorial. Its tools can be more focused: a shared game board, a pitch presentation,
an upload, or a scanner at the door.

This document describes design intent and priorities. It is not a release roadmap or proof of
production readiness.

## The experience

**Read and remember.** Words and Pics give stories and photographs room to breathe. Browsing,
reading, captions, and context come before interface furniture.

**Make something happen together.** Things includes solo puzzles, shared-device games, and
synchronized rooms. Each mode needs a reason for its device arrangement. Private information,
simultaneous choices, and accessibility can justify personal phones; an available room API alone
cannot. The [room-first standard](room-first-multiplayer.md) records this in detail.

**Run the gathering.** Events connects public discovery with tickets, attendee access, waitlists,
communications, and door operations. A person using a scanner needs an understandable result and
an explicit recovery path, especially on poor signal.

**Share deliberately.** Private transfers, protected writing, and source media stay distinct from
published content. Expiry, access, progress, and interruption should be visible and understandable.

## Priorities for changes

- **Clarity:** one obvious next action, useful empty states, and errors that explain recovery.
- **Continuity:** preserve drafts, accepted commands, uploads, and durable work across interruptions.
- **Privacy:** publish intentionally, authorize on the server, and keep credentials out of browser caches.
- **Room presence:** judge games by the conversation and participation they create, alongside correct rules.
- **Maintainability:** extend an existing feature boundary, keep deterministic rules small, and give each state one owner.

The [design language](design-language.md) carries these priorities through warm stone surfaces,
Lora for reading, Geist Mono for controls, hairline separators, and restrained motion.

## Product boundaries

The catalogue in [`features/things/catalog.ts`](../features/things/catalog.ts) is the source for
public Things. A feature existing in the tree does not make it part of that catalogue.

Tickets provide admission authority; they do not automatically claim a personal account or
establish a game identity. Door actions are request/response operations. Shared games use realtime
where another device's action must update the current screen.

Event scoring is retired from live product surfaces. Historical records and operational team
assignment remain; points, leaderboards, and automatic score consumption should not be advertised
as available features. See [events](events-platform.md).

Payments and delivery providers need explicit configuration. Local development is enough to
explore the application, but does not demonstrate a real payment, email delivery, or a production
worker. Automated game checks establish rules and recovery; first-time group playtests are still
needed to establish whether a mode works socially.

## Where to look next

[Architecture](architecture.md) explains how these experiences share one application.
[Navigation](navigation.md) describes the transitions between them.
[The docs index](README.md) leads to feature contracts and operational runbooks.
