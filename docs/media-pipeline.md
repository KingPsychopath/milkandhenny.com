# Media pipeline

## Storage boundary

R2 has two buckets with independent, single-bucket credentials.

| Private source bucket                  | Public delivery bucket            |
| -------------------------------------- | --------------------------------- |
| Album JSON manifests                   | Published album AVIF variants     |
| Incoming album uploads                 | Published album WebP variants     |
| Album originals                        | Published album social-card JPEGs |
| Draft copies of every album derivative | Public word media                 |
| Private word media and variants        | Public shared word assets         |
| Transfers and pitch assets             | Site delivery assets              |

The private bucket must have no custom domain and no `r2.dev` URL. Signed reads use `private, no-store`. The public bucket uses its custom domain and long cache lifetimes for versioned image variants.

Album manifests remain JSON because JSON is a suitable object-storage format. They do not live in the repository or container filesystem. Mutable words remain Markdown in their Redis-backed records. Repository JSON, Markdown, source code, fixtures, and generated static assets are valid only when they are configuration, test data, or build inputs rather than runtime product records.

## Album lifecycle

1. The browser uploads to `incoming/albums/{slug}/...` in private R2 with a short-lived presigned URL.
2. Finalisation decodes the file with Sharp. A decode failure rejects the upload.
3. The server writes a normalised private JPEG original, AVIF and WebP variants at 480, 960, and up to 1600 pixels, a 1200 × 630 social card, a dominant colour, and a small blur data URL.
4. Finalisation updates the private manifest and keeps the album in draft.
5. Publish copies only AVIF, WebP, and social-card objects to public R2, then marks the private manifest as published.
6. Unpublish hides the manifest first and deletes the public objects. It cannot recall copies that a visitor already downloaded or cached while the album was public.
7. Original downloads use an application route that confirms the album and photo are published before it issues a one-hour private signed URL.

Use an R2 lifecycle rule to expire `incoming/albums/` after one day. Finalisation also deletes its incoming objects immediately.

The gallery controls are available in the admin panel and through the shared CLI workflows:

```bash
pnpm cli albums create --slug summer-2026 --title "Summer 2026" --date 2026-08-24
pnpm cli albums upload summer-2026 --dir ~/Pictures/summer
pnpm cli albums update summer-2026 --status published
pnpm cli photos update summer-2026 IMG-001 --alt "Two guests dancing" --focal top
pnpm cli photos reorder summer-2026 --ids IMG-002,IMG-001
```

## Placeholder policy

Every processed image stores both values:

- Use the dominant colour in grids and dense lists. It is calm and prevents a wall of blurred miniature images.
- Use the blur placeholder for a hero, detail viewer, or other large image where the photographic transition adds value.

Both reserve the final aspect ratio, so they prevent layout shift. `AppImage` owns native lazy loading, decoding, fetch priority, dimensions, and responsive source handling. Only the likely largest-contentful image is eager and high priority.

## Metadata and file safety

Display derivatives are freshly encoded by Sharp, which removes source metadata. Album originals are also normalised to JPEG and stay private. Transfer originals remain unchanged because a transfer promises the source file; tell recipients that camera files can contain capture metadata.

Non-media transfers and all explicit downloads use attachment disposition and `application/octet-stream`. Protected redirects add `no-store`, `no-referrer`, and `nosniff`. A claimed MIME type never makes an album upload valid: successful image decoding is the validation boundary.

## Other media

- Public words write media to public R2. Private words write media and responsive variants to private R2 and use an authenticated, short-lived signed route.
- Transfers use capability IDs, Redis expiry records, private R2, short-lived signed previews, and attachment downloads. Ordinary images and GIFs process inline. RAW and video poster work can run in the media worker.
- Pitch images, audio, video, and thumbnails stay private. Access requires the pitch owner workflow and a short-lived signed URL.

See [media-worker.md](./media-worker.md) for queued RAW and video processing and [deployment.md](./deployment.md) for the bucket and lifecycle setup.
