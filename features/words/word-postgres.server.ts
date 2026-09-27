import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import {
  enqueueMediaObjectOperation,
  type ObjectScope,
} from "@/features/media/object-operations.server";
import type { NoteMeta, NoteRecord } from "./content-types";

type WordRow = {
  slug: string;
  title: string;
  subtitle: string | null;
  image: string | null;
  type: NoteMeta["type"];
  body_key: string;
  visibility: NoteMeta["visibility"];
  markdown: string;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  reading_time: number;
  reading_time_version: number;
  tags: string[];
  featured: boolean;
  author_role: "admin";
  revision: number;
  media_scope_dirty: boolean;
};

const WORD_COLUMNS = `slug, title, subtitle, image, type, body_key, visibility,
  markdown, created_at, updated_at, published_at, reading_time,
  reading_time_version, tags, featured, author_role, revision, media_scope_dirty`;
const WORD_META_COLUMNS = `slug, title, subtitle, image, type, body_key, visibility,
  created_at, updated_at, published_at, reading_time,
  reading_time_version, tags, featured, author_role, revision, media_scope_dirty`;

function metaFromRow(row: Omit<WordRow, "markdown">): NoteMeta {
  return {
    slug: row.slug,
    title: row.title,
    ...(row.subtitle !== null ? { subtitle: row.subtitle } : {}),
    ...(row.image !== null ? { image: row.image } : {}),
    type: row.type,
    bodyKey: row.body_key,
    visibility: row.visibility,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}),
    readingTime: row.reading_time,
    readingTimeVersion: row.reading_time_version,
    tags: row.tags,
    featured: row.featured,
    authorRole: row.author_role,
    revision: row.revision,
    mediaScopeDirty: row.media_scope_dirty,
  };
}

function fromRow(row: WordRow): NoteRecord {
  return { meta: metaFromRow(row), markdown: row.markdown };
}

export class WordRevisionConflictError extends Error {
  constructor() {
    super("This word changed while you were editing it. Reload and try again.");
    this.name = "WordRevisionConflictError";
  }
}

export async function readPostgresWord(slug: string): Promise<NoteRecord | null> {
  const row = await queryOne<WordRow>(`select ${WORD_COLUMNS} from words where slug = $1`, [slug]);
  return row ? fromRow(row) : null;
}

export async function readPostgresWordMeta(slug: string): Promise<NoteMeta | null> {
  const row = await queryOne<Omit<WordRow, "markdown">>(
    `select ${WORD_META_COLUMNS} from words where slug = $1`,
    [slug],
  );
  return row ? metaFromRow(row) : null;
}

export async function listPostgresWordMetas(): Promise<NoteMeta[]> {
  const rows = await query<Omit<WordRow, "markdown">>(
    `select ${WORD_META_COLUMNS} from words order by updated_at desc, slug`,
  );
  return rows.map(metaFromRow);
}

export async function savePostgresWord(record: NoteRecord): Promise<NoteRecord> {
  const meta = record.meta;
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `word:${meta.slug}`,
    ]);
    const current = await client.query<{
      revision: number;
      visibility: NoteMeta["visibility"];
      media_scope_dirty: boolean;
      media_source_scope: "private" | "public" | null;
    }>(
      "select revision, visibility, media_scope_dirty, media_source_scope from words where slug = $1 for update",
      [meta.slug],
    );
    const existing = current.rows[0];
    if (existing ? meta.revision !== existing.revision : meta.revision !== undefined)
      throw new WordRevisionConflictError();
    if (existing?.media_scope_dirty && existing.visibility !== meta.visibility)
      throw new Error("Word media is still moving. Please try again shortly.");
    if (!existing) {
      const unfinished = await client.query(
        `select 1 from media_object_operations where owner_kind='word' and owner_id=$1
           and operation='delete' and status <> 'completed' limit 1`,
        [meta.slug],
      );
      if (unfinished.rows[0]) throw new Error("Word media deletion is still in progress.");
    }
    const previous = existing
      ? 0
      : Number(
          (
            await client.query<{ revision: number }>(
              `select coalesce(max(owner_revision), 0) as revision from media_object_operations
                 where owner_kind='word' and owner_id=$1`,
              [meta.slug],
            )
          ).rows[0]?.revision ?? 0,
        );
    const revision = existing ? existing.revision + 1 : previous + 1;
    const values = [
      meta.slug,
      meta.title,
      meta.subtitle ?? null,
      meta.image ?? null,
      meta.type,
      meta.bodyKey,
      meta.visibility,
      record.markdown,
      meta.createdAt,
      meta.updatedAt,
      meta.publishedAt ?? null,
      meta.readingTime,
      meta.readingTimeVersion,
      meta.tags,
      meta.featured ?? false,
      meta.authorRole,
      revision,
    ];
    const result = existing
      ? await client.query(
          `update words set
             title=$2, subtitle=$3, image=$4, type=$5, body_key=$6,
             visibility=$7, markdown=$8, created_at=$9, updated_at=$10,
             published_at=$11, reading_time=$12, reading_time_version=$13,
             tags=$14, featured=$15, author_role=$16, revision=$17,
             media_scope_dirty=media_scope_dirty or visibility<>$7,
             media_source_scope=case when visibility<>$7 then
               case when visibility='private' then 'private' else 'public' end
               else media_source_scope end,
             source_rdb_sha256=null, source_meta_sha256=null, source_body_sha256=null
           where slug=$1 and revision=$18`,
          [...values, existing.revision],
        )
      : await client.query(
          `insert into words (slug, title, subtitle, image, type, body_key, visibility,
             markdown, created_at, updated_at, published_at, reading_time,
             reading_time_version, tags, featured, author_role, revision)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
           on conflict (slug) do nothing`,
          values,
        );
    if (result.rowCount !== 1) throw new WordRevisionConflictError();
    const saved: NoteRecord = {
      ...record,
      meta: {
        ...meta,
        revision,
        mediaScopeDirty:
          (existing?.media_scope_dirty ?? false) ||
          (existing !== undefined && existing.visibility !== meta.visibility),
      },
    };
    await client.query(
      `insert into word_revisions (slug, revision, meta, markdown, saved_at)
       values ($1,$2,$3::jsonb,$4,$5)`,
      [meta.slug, revision, JSON.stringify(saved.meta), record.markdown, meta.updatedAt],
    );
    return saved;
  });
}

export async function deletePostgresWord(
  slug: string,
  revision: number,
  discoverMedia: () => Promise<Array<{ scope: ObjectScope; key: string }>> = async () => [],
): Promise<boolean> {
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`word:${slug}`]);
    const current = await client.query<{ revision: number }>(
      "select revision from words where slug=$1 for update",
      [slug],
    );
    if (!current.rows[0]) return false;
    if (current.rows[0].revision !== revision) throw new WordRevisionConflictError();
    const media = await discoverMedia();
    for (const object of media)
      await enqueueMediaObjectOperation(client, {
        ownerKind: "word",
        ownerId: slug,
        ownerRevision: revision,
        operation: "delete",
        targetScope: object.scope,
        targetKey: object.key,
      });
    await client.query("delete from words where slug=$1 and revision=$2", [slug, revision]);
    return true;
  });
}

export async function inspectPostgresWords(repairRequested: boolean) {
  const rows = await query<{ count: string }>("select count(*)::text as count from words");
  return {
    records: Number(rows[0]?.count ?? 0),
    unindexed: [] as string[],
    dangling: [] as string[],
    missingBodies: [] as string[],
    repairRequested,
  };
}
