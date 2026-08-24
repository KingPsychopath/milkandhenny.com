# Admin UX map

The admin is an operational workspace. It should help one person choose a job, complete it, and leave without scanning unrelated controls.

## Primary work areas

```text
admin
├── overview       priorities, reports, shortcuts
├── content        writing, albums, shares, media audits
├── events         events, tickets, scanners, pitches
├── games          game-night entrances and room settings
├── transfers      active drops and media processing
└── system         health, runtime, sessions
```

Best Dressed is an event tool, not a top-level work area. It appears in the local event-tools navigation beside Events. The public voting page remains separate at `/best-dressed`.

## Page rules

- The workspace shell is wider than the public reading layout. Tables, image grids, and operational controls need room.
- Each primary area starts with a short purpose statement, then its most common actions, then detail panels.
- Destructive or high-risk actions stay near the resource they affect and keep their existing confirmation and step-up checks.
- Content keeps the editor and gallery together, but the gallery gets its own two-pane workspace: album list on the left, selected album on the right.

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

The gallery is an image-first task. Preview size and spacing take priority over fitting more controls into one viewport. Photo actions remain on each card so ordering and metadata work stays local to the image.

## Rhythm and control rules

- Use a clear section gap between work areas, a smaller gap inside a panel, and a tight gap only for related filters.
- Primary actions use a bordered or filled button with a 44px touch target. Underlined text is for secondary actions, but it still gets a usable hit area.
- Toolbars wrap on small screens. Stats collapse to one or two columns before they become narrow.
- Keep dangerous actions visually separate from routine actions. Confirmations and step-up checks stay attached to the action they protect.
- Use the image or resource title as the main anchor. IDs, timestamps, and storage details stay quiet until needed.
