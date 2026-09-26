# Words Postgres migration

Status: opt-in word body and metadata implementation rehearsed locally. Production still uses
Redis metadata and R2 Markdown. No production import or switch has occurred.

Migration `0107_words` stores Markdown, typed metadata and immutable revision snapshots in the
same database transaction. The `WORD_STORE=postgres` repository path preserves the existing
word shape, listing filters, original timestamps, slugs and Markdown bytes. Revision checks
refuse concurrent writes; reads do not repair or delete R2 objects. Images and other binary
media remain in R2. Revision snapshots are retained until the word is deleted, when its
snapshots cascade; a separate retention policy is required if historical revisions must survive
deletion.

The strict, checksum-verified RDB extractor accepts a final optional output path for word
metadata. It requires every `words:meta:*` key to have a matching `words:index` member and
writes private mode-0600 JSON. The importer validates each record, downloads its Markdown from
the bucket selected by visibility, checks UTF-8 bytes, and writes the catalogue and initial
revision in one transaction. The source RDB hash, metadata hash and body hash are retained for
reconciliation. It refuses conflicting target state; repeating the same source succeeds.

From the pinned Upstash parser checkout, supply the new word output path as the final argument
to `ops/legacy-guest-rdb-extract.go`. Then apply migration `0107` to a target with no application
word writes and run:

```sh
DATABASE_URL=… R2_ACCOUNT_ID=… R2_PRIVATE_BUCKET=… R2_PUBLIC_BUCKET=… \
  R2_PRIVATE_ACCESS_KEY=… R2_PRIVATE_SECRET_KEY=… \
  R2_PUBLIC_ACCESS_KEY=… R2_PUBLIC_SECRET_KEY=… \
  pnpm exec tsx --tsconfig tsconfig.cli.json ops/import-words.ts \
  /private/path/words.json RDB_SHA256 EXPECTED_COUNT
```

On 2026-09-26, the supplied RDB yielded 13 metadata records and 13 index members: six private,
four unlisted and three public. All 13 referenced R2 bodies were read into an isolated restore
of the production Postgres dump, totaling 29,046 UTF-8 bytes. Repeating the import succeeded;
an incorrect expected count failed. The restricted runtime role can use the new tables.

Do not select `WORD_STORE=postgres` in production yet. Word share links, PIN state and related
cleanup still use Redis. Visibility changes, image promotion and deletion still need durable R2
operation intents and reference-safe cleanup. Add those paths, import a fresh source delta, and
reconcile identities, exact Markdown hashes and access expiry before the planned cutover.
