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
- **Slide** — one editor-neutral scene, a 5–120 second timeline, file-to-asset references and
  bounded media clips.
- **Media clip** — video or sound with a timeline start, source trim, duration, volume, lock state
  and optional picture/sound link.
- **Access token** — a high-entropy capability for one owner device. Only its hash is stored.
- **Asset** — an image, optimized video or sound, or thumbnail stored in private R2.
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
- One recovery request sends a single email containing every active pitch for that address. A
  device holding more than one editing key can switch pitches directly inside the studio.

## Rehearsal mode

`/things/pitches/demo` runs the production editor with an explicit local-only session. It creates no
pitch, credential, browser draft, upload reservation, email or server mutation. Pasted images and
imports live only in the current tab; media upload and publishing are disabled. A person can still
preview and explicitly download PNG, SVG, ZIP or native backup files before leaving.

## Limits

Defaults are configuration, not scattered constants:

- 6 slides per deck (`PITCH_MAX_SLIDES`, allowed range 1–12).
- 3 active decks per email (`PITCH_MAX_DECKS_PER_EMAIL`, allowed range 1–10).
- 48 hours for an unpublished, inactive server draft (`PITCH_DRAFT_TTL_HOURS`).
- 10 MB per image, 15 MB per optimized audio file, 60 MB per optimized video, 30 MB per presentation
  import and 300 MB total per deck.
- 250 MB maximum source upload, 12 media clips per slide, 5–120 seconds per slide and a maximum
  120-second selected section from each source.
- 450 MB maximum `.mahdeck` backup. Upload reservations expire after five minutes, and unfinished
  reservations are removed by maintenance after one hour.
- Long media opens a browser trim step before MediaBunny remuxes or transcodes the selected section.

Published decks do not expire automatically. A cleanup job first marks abandoned drafts as
deleting, then removes R2 objects, then hard-deletes the relational records. A concurrent save
cannot lose media between the database check and object deletion. The same maintenance pass removes
upload reservations that never reached finalisation after one hour, removes ready assets that have
not been referenced by a draft, edition or backup for 24 hours, and prunes sync idempotency rows
after 30 days. Local browser drafts are deliberately not erased by server cleanup: they are the
offline recovery copy and remain under the control of that browser.

## Formats

- Native `.mahdeck` compressed bundles for a lossless editable backup with images, video and sound.
- PNG/SVG for a slide and a ZIP of PNGs for the full deck.
- PDF pages become high-fidelity static slide images in the browser.
- PPTX is parsed in the browser with JSZip. Common text and image content becomes editable elements,
  while embedded video and sound is optimized and placed on the slide timeline. Unsupported
  PowerPoint transitions and object animations become static instead of blocking the deck. Both
  presentation formats are scaled and centred into the product stage.

`.mahdeck` is the product's native file type. It is a versioned ZIP bundle with a `manifest.json`,
the complete editable document, embedded images, and every referenced optimized media file. The
importer rejects unknown versions, oversized entries, malformed manifests and media outside the
supported web formats. A backup exported by the studio is within the matching import limit.

Use these source choices:

- Google Slides: **File → Download → Microsoft PowerPoint (.pptx)** when movable text and pictures
  matter. Use **File → Download → PDF** when exact appearance matters more than editability.
- PowerPoint: save as `.pptx`. Use PDF for complex charts, SmartArt, unusual fonts, transitions or
  layout effects that must look exact.
- Canva: download PowerPoint for basic editable content, or PDF for exact visual placement.

PPTX import preserves the useful minimum: slide order, common text boxes, common pictures, slide
aspect ratio, and embedded video or sound that the browser can decode. Theme masters, unusual
fonts, charts, SmartArt, transitions and object animations are flattened or omitted. Import always
shows the slide count and asks whether to append or replace before it changes the deck.

Export `.mahdeck` when another person needs to continue editing in this studio. Export PNG or SVG
for one static slide. Export the full ZIP for static PNGs plus the editable `.mahdeck` backup.
There is no PowerPoint export because converting the freeform canvas and timed media back into an
editable PPTX would imply fidelity that the product cannot guarantee.

Direct Google, Microsoft and Canva connections are not required for the first release. Their
download flows produce the same files, avoid account-permission prompts, and keep the import result
explicit. Add a provider connection only when measured use shows that the file handoff is a real
source of failed imports.

The original PPTX or PDF is parsed in the browser and is not uploaded. Storage contains only the
images and optimized media that the resulting deck uses.

## Operating modes

The Pitches admin panel owns one persisted operating mode:

- `enabled` allows reads, server saves, uploads, recovery email, publishing and live presentation.
- `read-only` keeps published decks, owner reads, local browser safety copies, imports and exports
  available. Bundled `.mahdeck` media remains playable and re-exportable in the current tab without
  an upload. It blocks server saves, uploads, recovery email and publishing.
- `off` blocks public, owner and live presentation operations. Admin inspection and maintenance
  remain available so the mode can be changed and abandoned storage can still be cleaned.

`PITCHES_MODE=enabled|read-only|off` is the deployment safety ceiling. The effective mode is always
the more restrictive environment or admin value. An invalid environment value fails closed to
`off`. Each server process caches the persisted mode for at most five seconds. The editor checks
again when its tab becomes visible and every 30 seconds. A stale tab cannot bypass the server gate.

An upload URL issued before a mode change can remain valid for at most five minutes. Finalisation
is still blocked, and maintenance removes the unfinalised object after one hour.

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

The admin control room can change the operating mode, correct metadata, reassign ownership, resend access, inspect slide
previews and media state, restore a bounded backup, review audit history, archive, or delete a deck
to recoverable Trash. Maintenance permanently removes expired Trash records and their R2 objects.

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

Display mode, approved phone control, deck search, linked video and sound tracks, slide-clock
scrubbing and media playback.

### Phase 4 — invite

Route-isolated cinematic page, brand assets, reduced-motion fallback, and bidirectional event
links.
