# Pitch Night platform

Pitch Night is two connected products:

1. A small, offline-capable slide studio under `/things/pitches`.
2. A cinematic marketing route at `/pitch-night` that leads to the studio and the existing event
   checkout.

It stays inside the modular monolith. Postgres owns durable deck state, R2 owns uploaded media,
Redis owns short-lived presentation rooms, and the browser owns the fastest working copy.

## Editor boundary

The deck, slide, asset, sync, access, and presentation contracts are editor-neutral. Excalidraw is
isolated behind `ExcalidrawSurface`; only the opaque slide element payload needs a converter if the
object editor changes. Drawesome is isolated behind `DrawesomeInk` and maps its plain strokes into
the platform-owned `PitchInkStroke` shape. It is the tactile freehand layer, not a second source of
truth.

The product owns a fixed 960×540 stage. `pitch-stage.client.ts` injects it as locked editor chrome,
clips all editor content to it, and strips it before persistence. Thumbnails, preview, exports and
the presentation display use the same adapter, so changing the object editor cannot change what
counts as a slide.

## Domain language

- **Deck** — the owner, public metadata, lifecycle, current draft and published snapshot.
- **Slide** — one editor-neutral scene, a fixed duration, file-to-asset references and bounded
  audio cues.
- **Audio cue** — a slide entry or exit trigger with source trim, delay, volume and an explicit
  stop-at-slide-exit or continue-to-clip-end rule.
- **Access token** — a high-entropy capability for one owner device. Only its hash is stored.
- **Asset** — an image, audio file, thumbnail or import source stored in private R2.
- **Backup** — a bounded server snapshot made independently of the current draft.
- **Publish** — atomically copies the current draft into the public snapshot. Public readers never
  see half-edited work.
- **Presentation room** — an expiring Redis session connecting a display, a host and approved
  phone controllers.

## State and ownership

```text
browser IndexedDB working copy
  -> debounced optimistic sync
  -> pitch_decks.draft_document
       -> bounded pitch_deck_backups
       -> publish
       -> pitch_decks.published_document
            -> public gallery and presentation display
```

Published decks are sealed for public readers. An owner capability may keep editing the private
draft, but public output changes only after another explicit publish. This is safer than mutating
the version people may already be presenting.

Access tokens live in URL fragments and IndexedDB, never in query strings or logs. Recovery adds a
new device token and sends it only to the original email; it does not invalidate working devices.
Only the newest eight device and recovery keys remain valid for a deck, which bounds forgotten
links without unexpectedly signing out active creators. An admin owner reassignment is the one
intentional exception: it revokes every prior capability before a fresh link is sent to the new
address.

## Conflict and recovery policy

- Every sync carries a base version and a mutation id.
- Duplicate mutations are idempotent.
- A stale write is consolidated slide-by-slide and element-by-element. Excalidraw element versions
  decide element conflicts; slide tombstones prevent deleted slides from reappearing.
- The merged result is returned to the browser and saved locally.
- Local edits remain usable offline and retry when connectivity returns.
- The server keeps bounded periodic backups so an admin can inspect or recover earlier work.

## Limits

Defaults are configuration, not scattered constants:

- 6 slides per deck (`PITCH_MAX_SLIDES`, allowed range 1–12).
- 3 active decks per email (`PITCH_MAX_DECKS_PER_EMAIL`, allowed range 1–10).
- 48 hours for an unpublished, inactive server draft (`PITCH_DRAFT_TTL_HOURS`).
- 10 MB per image, 15 MB per audio file, 30 MB per import and 50 MB total per deck.
- 4 audio cues per slide; 5–120 seconds per slide and 120 seconds per source clip.
- Short audio is presentation accompaniment, not a media-hosting product.

Published decks do not expire automatically. A cleanup job first marks abandoned drafts as
deleting, then removes R2 objects, then hard-deletes the relational records. A concurrent save
cannot lose media between the database check and object deletion. The same maintenance pass removes
upload reservations that never reached finalisation after one hour.

## Formats

- Native `.mahdeck.json` for a lossless editable backup.
- PNG/SVG for a slide and a ZIP of PNGs for the full deck.
- PDF pages become editable slide backgrounds in the browser.
- PPTX is parsed in the browser with the existing JSZip dependency. Common text and image content
  becomes editable elements; unsupported PowerPoint effects degrade to a clean imported slide
  rather than blocking the deck. Both formats are scaled and centred into the product stage.

## Presentation model

The host creates a room and opens the display. A controller scans the room QR and waits for host
approval. Approved controllers can choose a published deck and move backwards or forwards. Every
command is idempotent and room state has a revision so stale phones cannot overwrite newer
navigation.

The display preloads the adjacent slide and its signed assets. A shared playback adapter runs the
same entry, exit, trim and continuation rules in preview, public viewing and presentation. Audio
starts only after the surface has been explicitly armed, respecting browser autoplay rules.

## Email and operations

Creation sends the owner a branded private-studio handoff. Publishing sends the sealed public link
while retaining the private editing link. Recovery and admin resend issue a new hashed capability.
Provider outcomes are recorded in the pitch audit log without turning a recoverable email failure
into a lost deck.

The admin control room can correct metadata, reassign ownership, resend access, inspect slide
previews and media state, restore a bounded backup, review audit history, archive, or delete a deck
and all of its R2 objects.

## Marketing and tickets

The marketing page is not a second ticket store:

```text
/pitch-night
  -> make a pitch -> /things/pitches/new
  -> get tickets -> /events/:slug
  -> Stripe-hosted Checkout
```

An event may set `marketingPath` to link back to the cinematic story. No cart is introduced: the
current one-event Checkout flow is faster and has less abandonment for this use case.

GSAP, ScrollTrigger and Three.js are dynamically imported inside `/pitch-night`. Reduced-motion,
low-power and WebGL-failure paths retain the complete story and calls to action without the 3D
scene.

## Delivery phases

### Phase 1 — author and publish

Gallery, owner identity, offline working copy, multi-slide Excalidraw editor, paste/upload,
optimistic sync, bounded backups, publish sealing, recovery email, and exports.

### Phase 2 — operate

Admin visibility, draft preview, email access recovery, retention cleanup, asset accounting,
PPTX/PDF imports, and audit events.

### Phase 3 — present

Display mode, approved phone control, deck search, adjacent-slide preloading, and short slide audio.

### Phase 4 — invite

Route-isolated cinematic page, brand assets, reduced-motion fallback, and bidirectional event
links.
