# Navigation and browser state

Milk & Henny is a collection of rooms and journeys, not one application shell
with the same controls on every screen. Navigation should tell someone where
they are, what level they can return to, and what will happen if they use the
browser Back button.

## The rule

Use the URL for a durable, addressable thing. Use application state for a live,
temporary interaction. Add a browser-history step only when Back should undo
or leave a user-visible mode.

That gives us three clear levels:

1. **Route navigation** moves between durable resources, such as an album, a
   photo, a word, an event, a ticket, a pitch, or a multiplayer room. The path
   is the identity and can be shared or reopened.
2. **Context navigation** helps someone move within a journey. Breadcrumbs
   show hierarchy on deep public pages. A contextual header link or a
   `JourneyRail` returns to the parent or moves to adjacent content. These are
   local to the journey, not a second global navigation bar.
3. **Interaction navigation** handles a mode inside one route, such as a live
   local game round. The mode gets one history entry so browser Back returns
   to the setup screen before it leaves the tool.

The brand link remains a quiet way home. It is not combined with a second
`← home` control beside the logo when a breadcrumb or contextual back link
already explains the route.

## What belongs where

| Surface                       | URL owns              | Browser Back                                          | Local or durable state                                                                  |
| ----------------------------- | --------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Public editorial content      | The resource path     | The previous page                                     | Server-rendered content and route data                                                  |
| Album and photo journeys      | Album/photo path      | The previous resource or page                         | Photo selection and viewer controls are local to the resource                           |
| Things index and setup        | The tool path         | Leave the tool when the user chooses Back             | Search, preferences, and setup choices are local unless they need a shareable URL       |
| Local game round              | The tool path         | Return to setup; a second Back leaves the tool        | Timers, scores, drawings, and motion state stay in React or tab-scoped recovery storage |
| Daily puzzle and archive      | The numbered day path | Return to the archive or previous page                | Per-browser progress is local; completed community summaries are durable                |
| Multiplayer room              | The room path         | Return to the previous route; keep a recoverable seat | Server room state and short-lived browser credentials                                   |
| Pitch studio and presentation | The deck or room path | Follow the studio or presentation control             | IndexedDB/browser working copy plus server versions where the feature supports them     |
| Dialogs and menus             | No URL by default     | Close with their own control or Escape                | Component state; use a route only when the surface must be linkable or restorable       |

## URL rules

- Use TanStack Router links and navigation for application routes. Do not use a
  global home link as a substitute for a meaningful parent destination.
- Use a path for a resource. Use search parameters for meaningful filters or
  recoverable view choices. Use a hash only for client-only view state whose
  restore behaviour is explicit.
- Never put live game state, credentials, personal data, or secrets in the
  URL. Feature-specific capability fragments are the exception only when the
  feature documents and protects them.
- Use `pushState` for a new user-visible mode and `replaceState` when correcting
  an existing URL. Do not push entries from ordinary renders or for every
  animation frame.
- If a URL state cannot be restored after refresh or direct opening, it is not
  a deep link. Keep it local or implement restoration before making it
  shareable.
- A user action that ends a local mode must remove its temporary history entry;
  it must not make the next Back press skip an unrelated page.
- A daily puzzle uses its immutable number in the path when the day itself is
  the resource. `/things/hot-and-cold/daily` always opens today, while
  `/things/hot-and-cold/daily/2` restores that exact historical puzzle and is
  the URL used by result shares and account history.

## Local game history

Local games use `useGameScreenHistory` for the setup-to-round transition. The
hook adds one same-URL history entry with a history-state marker. It does not
serialise the running game into the URL or expose a fragment that looks like a
deep link but cannot restore the round.

While the round is active:

```text
/things/spelling-bee
  -> start
/things/spelling-bee             (history state marks the active round)
  -> browser Back
/things/spelling-bee          (setup)
  -> browser Back
/things                       (tool index)
```

Ending the round through its own control returns to setup and removes the
temporary entry. Forward navigation must not resurrect a stale live screen.
If a future game can restore its complete live state safely, it may define a
stronger deep-link contract; the marker alone is not that contract.

Room-based games are different. Their room URL is the identity shared between
devices, and the room/server protocol remains authoritative. They should use
explicit leave or return controls for product meaning and must not pretend that
browser history can restore a disconnected room.

Managed entrances always require a join or return tap, including repeat visits and refreshes.
Browser Back must not be intercepted to wait for a server request or push the room into history
again. Explicit leave clears local recovery and gives the server a bounded chance to record the
departure; a rejected or unanswered request must still allow navigation. While offline, return to
Things without requesting a fresh entrance. Loading, missing-access, expired, and shared
presentation screens must retain a setup or Things link. Game dialogs remain dismissible while
their action is pending; closing a dialog does not roll back an in-flight server mutation.
Asynchronous setup and exit actions use `useGameNavigate` so completing an old request cannot
reopen a game after its screen has closed. Managed join requests also abort on entrance changes.

## Headers, breadcrumbs, and footers

- The home page is the starting room. It keeps its primary destinations and
  does not need a persistent back control.
- Deep public content uses breadcrumbs when hierarchy adds character or
  orientation. Keep the breadcrumb/header and the brand visually separated on
  narrow screens; they must never touch, wrap into each other, or compete for
  the same line.
- A full site footer belongs on public editorial, legal, contact, and
  subscription surfaces. It is not forced onto Things, live games, the pitch
  studio, admin, health, or transactional screens. Those products own their
  own exit and status controls.
- Use `JourneyRail` for parent/previous/next movement at the end of a deep
  content page. It is a contextual rail, not a global footer replacement or a
  site-wide navigation bar.
- Every navigation control keeps a minimum 44px target on touch devices and
  names the destination in text when an arrow alone would be unclear.

## Verification

When a change affects navigation or an in-place mode, check:

- direct opening and refresh of every URL state that is meant to be shareable;
- browser Back and Forward, including the first Back inside a live mode and the
  next Back that leaves it;
- explicit exit/end controls after using Back and Forward;
- narrow and wide layouts for header separation, breadcrumbs, rails, and
  footer wrapping;
- keyboard focus, Escape behaviour for dialogs, and reduced-motion behaviour
  where applicable.

The broader test boundary is in [testing.md](./testing.md). This document is
the product rule; individual features may add stricter rules for their own
credentials, persistence, or live-room protocol.
