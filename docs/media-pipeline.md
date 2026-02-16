# Media Pipeline

How images are processed, how OG images are generated, and how focal points work.

---

## File Type Support

| Type | In the gallery | Processing |
|------|---------------|------------|
| Images (JPEG, PNG, WebP, HEIC, HIF, TIFF) | Masonry grid + lightbox | Thumb (600px) + full (1600px) + original + og (1200×630) |
| GIFs | Grid card + animated lightbox | Static first-frame thumb + original |
| Videos (MP4, MOV, WebM, AVI, MKV) | Play icon card + video player lightbox | Uploaded as-is |
| Audio (MP3, WAV, FLAC, etc.) | Inline audio player card | Uploaded as-is |
| Documents / archives / everything else | File card + download button | Uploaded as-is |

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

### Vercel hobby limits

OG images are pre-built JPGs served from R2 — zero runtime serverless invocations. Build time fetches the og URL per page (one R2 GET each), but that's a one-time cost per deploy.

---

## Blog File Uploads

Media for blog posts is stored in R2 under `blog/{post-slug}/` and referenced directly in markdown. No manifest, no metadata store — the markdown file **is** the source of truth.

- **Images**: processed to WebP (max 1600px), rendered inline with captions
- **Videos, GIFs, audio, PDFs, zips, etc.**: uploaded as-is, rendered as download links

```bash
pnpm cli blog upload --slug <post-slug> --dir <path>   # Upload files (images → WebP, others raw)
pnpm cli blog list <post-slug>                          # List uploaded files + markdown snippets
pnpm cli blog delete <post-slug>                        # Delete ALL files for a post
pnpm cli blog delete <post-slug> --file <filename>      # Delete a single file
```

---

## Web Upload (Presigned URLs)

The upload page uses **presigned PUT URLs** so file bytes go directly from the browser to R2 — they never pass through Vercel. This removes the 4.5 MB serverless body limit and reduces Vercel bandwidth usage.

**Flow:** presign (tiny JSON request) → browser PUTs each file to R2 → finalize (tiny JSON request, server generates thumbnails).

Transfers use `POST /api/upload/transfer/presign` + `POST /api/upload/transfer/finalize`.

**R2 CORS requirement:** Your R2 bucket needs a CORS rule allowing PUT from your app origin:

```json
[
  {
    "AllowedOrigins": ["https://milkandhenny.com", "http://localhost:3000"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

---

## Image Rotation & HEIC/HIF Handling

Portrait photos often store pixel data in landscape orientation with a rotation instruction. Where that rotation lives depends on the format:

| Format | Rotation storage | How we handle it |
|--------|-----------------|-----------------|
| JPEG, PNG, TIFF, WebP | **EXIF** orientation tag | Sharp `.rotate()` reads EXIF and applies the transform |
| HEIC, HIF | **HEIF container** `irot` box (also EXIF in most Canon HIF) | libvips/libheif applies rotation at decode |

Both are handled automatically during upload. Sharp 0.33+ ships with libheif on all platforms — no OS-specific tools, fully cross-platform.

**Manual rotation override:** If EXIF data is missing or wrong (e.g. dragged from macOS Photos without metadata):

```bash
pnpm cli albums upload --dir ~/photos --slug my-album --title "My Album" --date 2026-02-13 --rotation portrait
pnpm cli photos add my-album --dir ~/more-photos --rotation landscape
```

**Tip:** On macOS, **export** from the Photos app (File → Export) rather than dragging. Export applies all edits and orientation.

---

## Focal Points & Face Detection

OG images crop to 1200×630. Every photo is run through **automatic face detection** during upload — the focal point is stored as `autoFocal` in the album JSON. For group photos, the focal point is the **area-weighted centroid** of all detected faces.

### Detection strategies

| Strategy | How it works | Best for |
|----------|-------------|----------|
| `onnx` (default) | UltraFace 320 neural network via ONNX Runtime (~1.2 MB model). True face detection with bounding boxes. | Portraits, group photos — any image with faces |
| `sharp` | Sharp's attention-based saliency (libvips). Detects skin tones, luminance, saturation. No ML model. | Scenes without faces, food, architecture |

### Manual override with presets

Manual always takes priority over auto-detected.

```bash
pnpm cli photos set-focal <album> <photoId> --preset t    # manual override: "top"
pnpm cli photos set-focal <album> <photoId> --preset c    # reset to "center"
```

### Preset reference

| Shorthand | Full name | Position (x%, y%) | When to use |
|-----------|-----------|-------------------|-------------|
| `c` | `center` | 50, 50 | Default — most landscape shots |
| `t` | `top` | 50, 0 | Face at top edge |
| `b` | `bottom` | 50, 100 | Subject at bottom of frame |
| `l` | `left` | 0, 50 | Subject at left edge |
| `r` | `right` | 100, 50 | Subject at right edge |
| `tl` | `top left` | 0, 0 | Top-left corner |
| `tr` | `top right` | 100, 0 | Top-right corner |
| `bl` | `bottom left` | 0, 100 | Bottom-left corner |
| `br` | `bottom right` | 100, 100 | Bottom-right corner |
| `mt` | `mid top` | 50, 25 | Upper third |
| `mb` | `mid bottom` | 50, 75 | Lower third |
| `ml` | `mid left` | 25, 50 | Left third |
| `mr` | `mid right` | 75, 50 | Right third |

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
3. Album embed thumbnails in blog posts use the focal point as CSS `object-position`

**When to manually override:** Only when auto-detection gets it wrong. Use `photos list <album>` to see focal points for each photo.

### Validate album JSON

```bash
pnpm cli albums validate   # Fails with exit code 1 if invalid — use in CI
```

Checks `focalPoint` presets and `autoFocal` values (x, y in 0–100).

---

## Blog Embed Cards

Standalone album links in blog posts (`[Title](/pics/slug)` on its own line) render as preview cards. Two variants:

- **Compact** (default): 4-thumb strip
- **Masonry**: Pinterest-style flowing tiles (up to 6 photos). Use `[Title](/pics/slug#masonry)`.

Inline mentions stay as normal links.

> **Staleness note**: Embed cards are resolved at build time (SSG). If you update an album after deploy, the card shows stale data until the next Vercel rebuild. This is consistent with how all album data works — JSON manifests live in git.
