# Words Postgres migration

Status: opt-in word body, metadata and share implementation rehearsed locally. Production still
uses Redis metadata/shares and R2 Markdown. No production import or switch has occurred.

Migration `0107_words` stores Markdown, typed metadata and immutable revision snapshots in the
same database transaction. The `WORD_STORE=postgres` repository path preserves the existing
word shape, listing filters, original timestamps, slugs and Markdown bytes. Revision checks
refuse concurrent writes; reads do not repair or delete R2 objects. Images and other binary
media remain in R2. Revision snapshots are retained until the word is deleted, when its
snapshots cascade; a separate retention policy is required if historical revisions must survive
deletion.

Migration `0108_word_shares` stores link identity, token hash, PIN hash and invalidation time,
expiry, revocation and a revision. It has a foreign key to the word. With
`WORD_SHARE_STORE=postgres`, link creation, rotation, revocation and cleanup use this table;
PIN attempts use the shared Postgres limiter when `RATE_LIMIT_STORE=postgres` is selected.
The token and signed-cookie formats are unchanged. An update refuses a stale revision.

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

The RDB extractor's next optional output path captures share records, their absolute Redis
record expiries, and validates both share indexes. After importing the words, run:

```sh
DATABASE_URL=… pnpm exec tsx --tsconfig tsconfig.cli.json ops/import-word-shares.ts \
  /private/path/word-shares.json RDB_SHA256 EXPECTED_COUNT
```

The supplied RDB has zero share records and zero tracked share slugs. Its empty import succeeded
twice on the isolated restore; a count mismatch failed. The user designated this first verified
export as the source cutoff and accepted later Redis-only loss. A synthetic one-link import also repeated cleanly and rejected a
different source hash. Keep `AUTH_SECRET` unchanged for signed access cookies.

Do not select `WORD_STORE=postgres`, `WORD_SHARE_STORE=postgres` or their PIN rate limiter in
production yet. Visibility changes, image promotion and deletion still need durable R2 operation
intents and reference-safe cleanup. Add those paths, import the verified cutoff export, and reconcile
identities, exact Markdown hashes, share state and access expiry before the planned cutover.
