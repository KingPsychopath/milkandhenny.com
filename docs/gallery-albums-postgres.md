# Gallery album Postgres migration

Status: opt-in implementation rehearsed locally. Production still reads and writes private R2
manifests; no production import or switch has occurred.

Migration `0106_gallery_albums` stores album metadata, ordered photo metadata and a revision.
A deferred composite foreign key requires the cover photo to belong to its album. A write replaces
the photo set in one transaction and refuses a stale revision. Binary originals, derivatives and
social cards stay in R2. `ALBUM_STORE=postgres` selects the new repository; leave it unset until
the final source import and reconciliation pass.

The importer reads only `albums/_manifests/*.json` from the private bucket. It validates the
manifest shape, identity and expected manifest count before writing a Postgres transaction. It
stores the source key and SHA-256 digest, preserves photo IDs/order/metadata and refuses target
rows with another source or runtime edits. Repeating the same source is allowed. It does not copy
or delete any R2 object.

After applying migration `0106`, run against a target with no application album writes:

```sh
DATABASE_URL=… R2_ACCOUNT_ID=… R2_PRIVATE_BUCKET=… \
  R2_PRIVATE_ACCESS_KEY=… R2_PRIVATE_SECRET_KEY=… \
  pnpm exec tsx --tsconfig tsconfig.cli.json ops/import-gallery-albums.ts EXPECTED_COUNT
```

On 2026-09-26, an isolated restore of the production Postgres dump accepted two manifests and
14 photos from private R2. Repeating the import succeeded; an expected count of three failed.
Earlier read-only R2 reconciliation found all 14 originals, 84 public variants and 14 social
cards referenced by those manifests. Recheck these counts, identities, source digests and object
references against a fresh source snapshot at cutover.

The admin album workflows still combine catalogue changes with R2 publish, unpublish, regenerate
and delete operations without durable object-operation intents. A failure or concurrent edit may
leave the catalogue and R2 objects out of sync. Implement and verify tracked intents, reference-
safe deletion and interrupted-operation repair before selecting `ALBUM_STORE=postgres` in
production. Preserve the source manifests and object history through the observation period.
