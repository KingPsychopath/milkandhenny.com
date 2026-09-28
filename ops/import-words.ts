import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Client } from "pg";

import { isWordVisibility, type NoteMeta } from "@/features/words/content-types";
import { isWordType } from "@/features/words/types";

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const META_FIELDS = new Set([
  "slug",
  "title",
  "subtitle",
  "image",
  "type",
  "bodyKey",
  "visibility",
  "createdAt",
  "updatedAt",
  "publishedAt",
  "readingTime",
  "readingTimeVersion",
  "tags",
  "featured",
  "authorRole",
]);

type SourceRow = { slug: string; value: unknown };
type SourceWord = { meta: NoteMeta; markdown: string; metaHash: string; bodyHash: string };

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseMeta(row: SourceRow): NoteMeta {
  const value = row.value;
  if (!value || typeof value !== "object") throw new Error("Invalid source word metadata");
  const meta = value as Partial<NoteMeta>;
  if (
    Object.keys(meta).some((key) => !META_FIELDS.has(key)) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.slug) ||
    meta.slug !== row.slug ||
    typeof meta.title !== "string" ||
    !meta.title.trim() ||
    !meta.type ||
    !isWordType(meta.type) ||
    !isWordVisibility(meta.visibility) ||
    typeof meta.bodyKey !== "string" ||
    !meta.bodyKey.startsWith(`words/${meta.type}/${row.slug}/`) ||
    !meta.bodyKey.endsWith("/content.md") ||
    meta.bodyKey.includes("..") ||
    typeof meta.createdAt !== "string" ||
    !Number.isFinite(Date.parse(meta.createdAt)) ||
    typeof meta.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(meta.updatedAt)) ||
    (meta.publishedAt !== undefined &&
      (typeof meta.publishedAt !== "string" || !Number.isFinite(Date.parse(meta.publishedAt)))) ||
    (meta.visibility === "public" && !meta.publishedAt) ||
    !Number.isInteger(meta.readingTime) ||
    !meta.readingTime ||
    meta.readingTime < 1 ||
    !Number.isInteger(meta.readingTimeVersion) ||
    meta.readingTimeVersion === undefined ||
    meta.readingTimeVersion < 0 ||
    !Array.isArray(meta.tags) ||
    meta.tags.some((tag) => typeof tag !== "string") ||
    typeof meta.featured !== "boolean" ||
    meta.authorRole !== "admin" ||
    (meta.subtitle !== undefined && typeof meta.subtitle !== "string") ||
    (meta.image !== undefined && typeof meta.image !== "string")
  )
    throw new Error("Invalid source word metadata");
  return meta as NoteMeta;
}

async function main() {
  const [sourcePath, rdbHash, expectedRaw] = process.argv.slice(2);
  const expected = Number(expectedRaw);
  if (
    !sourcePath ||
    !/^[a-f0-9]{64}$/.test(rdbHash ?? "") ||
    !Number.isInteger(expected) ||
    expected < 0
  )
    throw new Error(
      "Usage: tsx ops/import-words.ts <private-words-json> <rdb-sha256> <expected-count>",
    );
  const info = await stat(sourcePath);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Source file must be private");
  const parsed = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== expected)
    throw new Error("Word metadata count differs from preflight");
  const rows = parsed as SourceRow[];
  const slugs = new Set<string>();
  const endpoint =
    process.env.S3_ENDPOINT ?? `https://${requiredEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  const createStorage = (scope: "PRIVATE" | "PUBLIC") =>
    new S3Client({
      region: "auto",
      endpoint,
      forcePathStyle: Boolean(process.env.S3_ENDPOINT),
      credentials: {
        accessKeyId: requiredEnv(`R2_${scope}_ACCESS_KEY`),
        secretAccessKey: requiredEnv(`R2_${scope}_SECRET_KEY`),
      },
    });
  const privateStorage = createStorage("PRIVATE");
  const publicStorage = createStorage("PUBLIC");
  const sources: SourceWord[] = [];
  try {
    for (const row of rows) {
      const meta = parseMeta(row);
      if (slugs.has(meta.slug)) throw new Error("Duplicate source word slug");
      slugs.add(meta.slug);
      const bucket =
        meta.visibility === "private"
          ? requiredEnv("R2_PRIVATE_BUCKET")
          : requiredEnv("R2_PUBLIC_BUCKET");
      const storage = meta.visibility === "private" ? privateStorage : publicStorage;
      const object = await storage.send(
        new GetObjectCommand({ Bucket: bucket, Key: meta.bodyKey }),
      );
      if (!object.Body) throw new Error("Word body is missing");
      if (object.ContentLength && object.ContentLength > MAX_BODY_BYTES)
        throw new Error("Word body is too large");
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      if (bytes.length > MAX_BODY_BYTES) throw new Error("Word body is too large");
      const markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (!Buffer.from(markdown, "utf8").equals(bytes)) throw new Error("Word body is not UTF-8");
      sources.push({
        meta,
        markdown,
        metaHash: digest(JSON.stringify(row.value)),
        bodyHash: digest(bytes),
      });
    }

    const client = new Client({ connectionString: requiredEnv("DATABASE_URL") });
    await client.connect();
    try {
      await client.query("begin");
      const existing = await client.query<{
        slug: string;
        source_rdb_sha256: string | null;
        source_meta_sha256: string | null;
        source_body_sha256: string | null;
        markdown: string;
      }>(
        "select slug, source_rdb_sha256, source_meta_sha256, source_body_sha256, markdown from words for update",
      );
      if (existing.rows.length > sources.length) throw new Error("Target has extra words");
      for (const row of existing.rows) {
        const source = sources.find(({ meta }) => meta.slug === row.slug);
        if (
          !source ||
          row.source_rdb_sha256 !== rdbHash ||
          row.source_meta_sha256 !== source.metaHash ||
          row.source_body_sha256 !== source.bodyHash ||
          digest(row.markdown) !== source.bodyHash
        )
          throw new Error("Target has runtime or conflicting word data");
      }
      for (const source of sources) {
        if (existing.rows.some(({ slug }) => slug === source.meta.slug)) continue;
        const { meta, markdown } = source;
        await client.query(
          `insert into words
             (slug, title, subtitle, image, type, body_key, visibility, markdown,
              created_at, updated_at, published_at, reading_time, reading_time_version,
              tags, featured, author_role, revision,
              source_rdb_sha256, source_meta_sha256, source_body_sha256)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,1,$17,$18,$19)`,
          [
            meta.slug,
            meta.title,
            meta.subtitle ?? null,
            meta.image ?? null,
            meta.type,
            meta.bodyKey,
            meta.visibility,
            markdown,
            meta.createdAt,
            meta.updatedAt,
            meta.publishedAt ?? null,
            meta.readingTime,
            meta.readingTimeVersion,
            meta.tags,
            meta.featured,
            meta.authorRole,
            rdbHash,
            source.metaHash,
            source.bodyHash,
          ],
        );
        await client.query(
          `insert into word_revisions (slug, revision, meta, markdown, saved_at)
           values ($1,1,$2::jsonb,$3,$4)`,
          [meta.slug, JSON.stringify({ ...meta, revision: 1 }), markdown, meta.updatedAt],
        );
      }
      await client.query("commit");
      console.log(`words=${sources.length} markdown_bodies=${sources.length}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      await client.end();
    }
  } finally {
    privateStorage.destroy();
    publicStorage.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
