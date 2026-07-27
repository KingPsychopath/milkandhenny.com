# Media Pipeline

How images are processed, how OG images are generated, and how focal points work.

---

## File Type Support

| Type                                      | In the gallery                         | Processing                                                     |
| ----------------------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| Images (JPEG, PNG, WebP, TIFF)            | Masonry grid + lightbox                | Thumb (600px) + full (1600px) + original + og (1200×630)        |
| HEIC / HIF                                | Same as images, once converted         | Converted to JPEG **in the browser** before upload              |
| RAW (DNG, ARW, CR2/CR3, NEF, ORF, RAF, RW2) | Grid card + lightbox                 | Embedded camera preview → thumb + full, **queued to the worker** |
| GIFs                                      | Grid card + animated lightbox          | Static first-frame thumb + original                             |
| Videos (MP4, MOV, WebM, AVI, MKV, …)      | Poster card with play overlay, lightbox player | Poster frame → thumb + full, **queued**; the video itself is stored as-is, never transcoded |
| Audio (MP3, WAV, FLAC, …)                 | Inline audio player card               | Stored as-is                                                    |
| Documents / archives / everything else    | File card + download button            | Stored as-is                                                    |

---

## Who Decodes What

Every format lands in exactly one of three places. The split is not arbitrary —
it follows from where the decoder actually exists.

### Browser — HEIC/HIF only

Sharp in the runtime image cannot be assumed to decode HEIF, and iPhones
produce it by default, so transfers convert it client-side before upload:
`prepareTransferUploadFile` produces a JPEG, uploads that as the primary, and
archives the untouched original alongside it (`originalStorageKey`,
`convertedFrom: "heic"`), so nobody loses their source file.

All four transfer upload routes reject a HEIF-looking file server-side
(`HEIF_TRANSFER_UPLOAD_ERROR`) rather than accepting something they cannot
process. Set `VITE_TRANSFER_MEDIA_BROWSER_PREP=off` and HEIC uploads are
refused outright — the honest outcome, since nothing downstream can read them.

### Web server, inline — ordinary images and GIFs

JPEG/PNG/WebP/TIFF and GIFs finish in Sharp in well under a second. Queueing
them would add latency and Redis traffic for no gain.

### Media worker, queued — RAW and video

Both are expensive and both shell out to a binary:

- **RAW** → `exiftool -b -PreviewImage` (then `-JpgFromRaw`, `-ThumbnailImage`).
  We extract the camera's embedded JPEG preview rather than demosaicing the
  sensor data: it is the image the photographer saw on the camera back, it is
  already white-balanced and tone-mapped, and it costs milliseconds instead of
  seconds. A file with no embedded preview is `raw_preview_unavailable` — a
  terminal state, never retried, because a second attempt runs the same command
  for the same answer. The original stays downloadable.
- **Video** → `ffprobe` for dimensions and duration, then `ffmpeg` for one
  frame at roughly 10% in (never frame zero, which is often black). The source
  streams object storage → temp file → ffmpeg and is never held in memory.
  Above `MEDIA_VIDEO_POSTER_MAX_BYTES` the poster is skipped and the video is
  left playable without one.

Both binaries are in the runtime image for both roles, so the split is about
resources, not capability. See [media-worker.md](./media-worker.md).

### Rotation

Handled once, centrally, in `autoRotate`: Sharp reads the EXIF orientation tag
and applies it for JPEG/PNG/TIFF/WebP; HEIF container rotation (`irot`) is
resolved by whichever decoder produced the buffer. Video posters go through the
same path, so a portrait clip gets a portrait poster.

---

## OG Images at Scale

Album and photo pages have Open Graph images for social sharing. Source images are pre-processed to **1200×630 JPG** with a **text overlay** (album title, photo ID, brand) burned in via SVG compositing, then stored in R2 at `albums/{slug}/og/{photoId}.jpg`.

The `opengraph-image.tsx` routes fetch and serve these pre-built JPGs — no `ImageResponse`, no runtime PNG generation.

### Pipeline (upload → OG)

1. **Face detection** — ONNX UltraFace (or Sharp saliency) finds faces, computes area-weighted centroid
2. **Crop** — Sharp crops the original to 1200×630, anchored on the detected focal point
3. **Text overlay** — SVG with gradient + brand text composited onto the cropped image
4. **Compress** — JPEG quality 70 with mozjpeg (~80–150 KB per image)
5. **Upload** — Stored in R2 at `albums/{slug}/og/{photoId}.jpg`

### Workflow

- **New uploads:** `pnpm cli albums upload` and `photos add` automatically run face detection and create all variants (thumb, full, original, og).
- **Existing albums:** Run backfill once: `pnpm cli albums backfill-og` (or `--yes` to skip confirmation). Skips photos that already have og variants. Use `--force` to regenerate all.

```bash
pnpm cli albums backfill-og --yes          # First run after adding OG support
pnpm cli albums backfill-og --yes --force  # Regenerate all
```

### Transfer OG image

Unlike albums, transfer metadata lives in Redis so there's no build-time manifest. The transfer OG image is **generated at request time** when a crawler first hits the image URL: one serverless run per transfer ID, then cached for 24h (`s-maxage=86400`). To use the default site OG image instead, remove `app/t/[id]/opengraph-image.tsx`.

### Runtime limits

OG images are pre-built JPGs served from R2, so the application host does not process them per request.

---

## Words Media Uploads

Media for words content is stored in R2 under `words/media/{slug}/` and referenced directly in markdown. Shared reusable assets live under `words/assets/{assetId}/`.

- **Images**: processed to WebP (max 1600px), rendered inline with captions
- **Videos, GIFs, audio, PDFs, zips, etc.**: uploaded as-is, rendered as download links

```bash
pnpm cli media upload --slug <word-slug> --dir <path>   # Upload files (images → WebP, others raw)
pnpm cli media list --slug <word-slug>                   # List uploaded files + markdown snippets
pnpm cli media delete --slug <word-slug>                 # Delete ALL files for a word
pnpm cli media delete --slug <word-slug> --file <name>   # Delete a single file
pnpm cli media upload --asset <asset-id> --dir <path>    # Upload shared reusable assets
```

Web upload: `/upload` supports words uploads via presigned PUT URLs, so file bytes bypass the application host. For large batches, the CLI is still faster and easier to retry.

---

## Web Upload (Presigned URLs)

The upload page uses **presigned PUT URLs** so file bytes go directly from the browser to R2. This avoids application-server body limits and bandwidth.

**Flow:** presign (tiny JSON request) → browser PUTs each file to R2 → finalize (tiny JSON request, server generates derivatives for the inline routes and queues the rest).

Finalize returns immediately for queued files — they come back as `original_only`. Their previews arrive later over SSE (`GET /api/transfers/:id/events`) and patch into the gallery in place, so a page showing a fresh transfer fills in its RAW and video thumbnails without a refresh and without polling.

Transfers use `POST /api/upload/transfer/presign` + `POST /api/upload/transfer/finalize`.

### Upload window

Every presigned PUT for a batch is signed **before the first byte moves**, so
the expiry has to cover the whole selection, not one request. `TRANSFER_UPLOAD_URL_TTL_SECONDS`
defaults to 6 hours, and the upload reservation is always minted 30 minutes
longer than the URLs it guards — an upload that finishes inside the window must
still find something to finalise against.

At the old 15 minutes, a guest emptying a phone over hotel wifi hit dead URLs
partway through the batch, and a finalize arriving after an hour of successful
uploading was rejected outright.

A single PUT cannot exceed **5 GiB** (the S3/R2 limit; we do not implement
multipart). That is now rejected up front for everyone, admins included, rather
than failing with an opaque `EntityTooLarge` after hours of transfer.

Finalize verifies every object exists and that its stored size matches what was
reserved, so a truncated upload is rejected rather than recorded as complete.

**Private R2 CORS requirement:** `R2_PRIVATE_BUCKET` needs a CORS rule allowing signed uploads and reads from your app origin:

```json
[
  {
    "AllowedOrigins": ["https://milkandhenny.com", "http://localhost:3000"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type", "Range"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## Manual Rotation Override

Portrait photos usually carry their orientation as an instruction rather than as
pixel layout — EXIF for JPEG/PNG/TIFF/WebP, the `irot` box for HEIF — and
[`autoRotate`](#rotation) applies it. When that metadata is missing or wrong If EXIF data is missing or wrong (e.g. dragged from macOS Photos without metadata), override it:

```bash
pnpm cli albums upload --dir ~/photos --slug my-album --title "My Album" --date 2026-02-13 --rotation portrait
pnpm cli photos add my-album --dir ~/more-photos --rotation landscape
```

**Tip:** On macOS, **export** from the Photos app (File → Export) rather than dragging. Export applies all edits and orientation.

---

## Focal Points & Face Detection

OG images crop to 1200×630. Every photo is run through **automatic face detection** during upload — the focal point is stored as `autoFocal` in the album JSON. For group photos, the focal point is the **area-weighted centroid** of all detected faces.

### Detection strategies

| Strategy         | How it works                                                                                            | Best for                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `onnx` (default) | UltraFace 320 neural network via ONNX Runtime (~1.2 MB model). True face detection with bounding boxes. | Portraits, group photos — any image with faces |
| `sharp`          | Sharp's attention-based saliency (libvips). Detects skin tones, luminance, saturation. No ML model.     | Scenes without faces, food, architecture       |

### Manual override with presets

Manual always takes priority over auto-detected.

```bash
pnpm cli photos set-focal <album> <photoId> --preset t    # manual override: "top"
pnpm cli photos set-focal <album> <photoId> --preset c    # reset to "center"
```

### Preset reference

| Shorthand | Full name      | Position (x%, y%) | When to use                    |
| --------- | -------------- | ----------------- | ------------------------------ |
| `c`       | `center`       | 50, 50            | Default — most landscape shots |
| `t`       | `top`          | 50, 0             | Face at top edge               |
| `b`       | `bottom`       | 50, 100           | Subject at bottom of frame     |
| `l`       | `left`         | 0, 50             | Subject at left edge           |
| `r`       | `right`        | 100, 50           | Subject at right edge          |
| `tl`      | `top left`     | 0, 0              | Top-left corner                |
| `tr`      | `top right`    | 100, 0            | Top-right corner               |
| `bl`      | `bottom left`  | 0, 100            | Bottom-left corner             |
| `br`      | `bottom right` | 100, 100          | Bottom-right corner            |
| `mt`      | `mid top`      | 50, 25            | Upper third                    |
| `mb`      | `mid bottom`   | 50, 75            | Lower third                    |
| `ml`      | `mid left`     | 25, 50            | Left third                     |
| `mr`      | `mid right`    | 75, 50            | Right third                    |

**Priority:** manual preset (`focalPoint`) > auto-detected (`autoFocal`) > center (50%, 50%).

### Reset & re-detect

```bash
pnpm cli photos reset-focal <album> [photoId]              # Clear manual, re-detect, regen OG
pnpm cli photos reset-focal <album> --strategy sharp        # Use sharp saliency instead
pnpm cli photos compare-focal <album> <photoId>             # Compare both strategies
```

### Batch regen

```bash
pnpm cli albums backfill-og --yes --force                   # All with onnx (default)
pnpm cli albums backfill-og --yes --force --strategy sharp  # All with sharp
```

### What happens when you set a focal point

1. Updates `focalPoint` (manual) or `autoFocal` (detected) in `content/albums/{slug}.json`
2. Downloads original from R2, re-crops to 1200×630, uploads new og variant
3. Album embed thumbnails in words pages use the focal point as CSS `object-position`

**When to manually override:** Only when auto-detection gets it wrong. Use `photos list <album>` to see focal points for each photo.

### Validate album JSON

```bash
pnpm cli albums validate   # Fails with exit code 1 if invalid — use in CI
```

Checks `focalPoint` presets and `autoFocal` values (x, y in 0–100).

---

## Words Embed Cards

Standalone album links in words pages (`[Title](/pics/slug)` on its own line) render as preview cards. Two variants:

- **Compact** (default): 4-thumb strip
- **Masonry**: Pinterest-style flowing tiles (up to 6 photos). Use `[Title](/pics/slug#masonry)`.

Inline mentions stay as normal links.

> **Staleness note**: Embed cards are resolved at build time. If you update an album after deploy, the card remains stale until the next application build because JSON manifests live in git.
