# Admin UX map

The admin is an operational workspace. It should help one person choose a job, complete it, and
leave without scanning unrelated controls.

## Primary work areas

```text
admin
├── overview          priorities, reports, shortcuts
├── content           writing, albums, shares, media audits
├── events            events, tickets, staff access, checkpoints, teams, pitches
├── people & support  identity, ticket history, restrictions, support cases (`view=operations`)
├── communications    drafts, scheduled messages, templates, people
└── games             game-night entrances, room pools, default settings

utilities and policies
├── file delivery     upload access, active drops, media processing (`view=transfers`)
├── system            health, multiplayer runtime, sessions
└── access policies   attendee capabilities and administrator access (`view=settings`)
```

Best Dressed is an event tool, not a top-level work area. It appears in the local event-tools
navigation beside Events. The public voting page remains separate at `/best-dressed`.

## Structure rules

- Each work area is its own panel component under `features/admin/ui/components/`. A panel owns
  its data loading, actions, and confirmation dialogs; the dashboard shell owns navigation, the
  shared status line, and the overview/system snapshot.
- Events and Pitch Night are sibling workspaces inside the Events area; only the chosen workspace
  mounts. Event management itself is master-detail, and create, edit, and ticket/staff work are
  mutually exclusive.
- Event-night operations are capability-shaped. A staff link composes only its door, checkpoint,
  guest, team, and photo tools. Retired scoring permissions do not resurrect a scoring screen.
- Team setup is pre-event work: balance every valid ticket, then deliberately email the final team
  cards. Check-in is a separate arrival fact and never gates assignment.

## Page rules

- The workspace shell is wider than the public reading layout. Tables, image grids, and
  operational controls need room.
- The shell provides one concise current-area description. Panels start with their own useful
  context or actions instead of repeating the shell heading and purpose copy.
- Display labels may become clearer without changing stable `view` query values used by deep
  links and saved URLs.
- Destructive or high-risk actions stay near the resource they affect and keep their existing
  confirmation and step-up checks.
- Content keeps the editor and gallery together, with local workspaces for albums, shared pages,
  recent content, and maintenance. Rare cleanup controls stay collapsed in maintenance. The
  gallery keeps its own two-pane workspace: album list on the left, selected album on the right.
- List/detail tools replace the list with the selected detail on small screens and provide an
  explicit back action. Wider screens may keep the list beside the selected resource.

## Gallery control room

```text
gallery control room
├── album list        search, select, create
└── selected album
    ├── album details  title, date, description, status, public links
    ├── upload bay     drop, paste, choose photos, progress
    ├── photo filter   search and bulk selection
    └── photo grid     larger previews, ordering, cover, metadata, delete
```

The gallery is an image-first task. Preview size and spacing take priority over fitting more
controls into one viewport. Photo actions remain on each card so ordering and metadata work stays
local to the image.

## Rhythm and control rules

- Use a clear section gap between work areas, a smaller gap inside a panel, and a tight gap only
  for related filters.
- Keep the workspace neutral-first. Use green only for healthy or successful state, amber for work
  waiting or needing attention, and red for an actual failure or block. Inactive, expired, and
  historical state stays grey. Every state keeps a written label; colour is a scanning aid, not the
  only carrier of meaning.
- Primary actions use a bordered or filled button with a 44px touch target. Underlined text is for
  secondary actions, but it still gets a usable hit area.
- Toolbars wrap on small screens. Stats collapse to one or two columns before they become narrow.
- Door and checkpoint tools assume one hand, poor signal, noise, and time pressure. The current
  station is explicit, search tolerates names or ticket references, QR capture lives inside that
  search control, and a grouped order can be admitted without scanning each code.
- Keep dangerous actions visually separate from routine actions. Confirmations and step-up checks
  stay attached to the action they protect.
- Use the image or resource title as the main anchor. IDs, timestamps, and storage details stay
  quiet until needed.
