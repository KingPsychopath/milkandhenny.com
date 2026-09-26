import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Client } from "pg";

import type { ShareLink } from "@/features/words/content-types";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FIELDS = new Set([
  "id",
  "slug",
  "tokenHash",
  "expiresAt",
  "pinRequired",
  "pinHash",
  "pinUpdatedAt",
  "revokedAt",
  "createdAt",
  "updatedAt",
  "createdByRole",
]);

type SourceRow = { id: string; value: unknown; recordExpiresAt: string };

function parseShare(row: SourceRow): ShareLink {
  const value = row.value;
  if (!value || typeof value !== "object") throw new Error("Invalid source share record");
  const link = value as Partial<ShareLink>;
  if (
    Object.keys(link).some((key) => !FIELDS.has(key)) ||
    !UUID.test(row.id) ||
    link.id !== row.id ||
    typeof link.slug !== "string" ||
    !SLUG.test(link.slug) ||
    typeof link.tokenHash !== "string" ||
    !SHA256.test(link.tokenHash) ||
    typeof link.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(link.expiresAt)) ||
    typeof link.pinRequired !== "boolean" ||
    (link.pinHash !== undefined &&
      (typeof link.pinHash !== "string" || !SHA256.test(link.pinHash))) ||
    (link.pinRequired && !link.pinHash) ||
    (link.pinUpdatedAt !== undefined &&
      (typeof link.pinUpdatedAt !== "string" || !Number.isFinite(Date.parse(link.pinUpdatedAt)))) ||
    (link.revokedAt !== undefined &&
      (typeof link.revokedAt !== "string" || !Number.isFinite(Date.parse(link.revokedAt)))) ||
    typeof link.createdAt !== "string" ||
    !Number.isFinite(Date.parse(link.createdAt)) ||
    typeof link.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(link.updatedAt)) ||
    link.createdByRole !== "admin" ||
    !Number.isFinite(Date.parse(row.recordExpiresAt))
  )
    throw new Error("Invalid source share record");
  return link as ShareLink;
}

async function main() {
  const [sourcePath, rdbHash, expectedRaw] = process.argv.slice(2);
  const expected = Number(expectedRaw);
  if (!sourcePath || !SHA256.test(rdbHash ?? "") || !Number.isInteger(expected) || expected < 0)
    throw new Error(
      "Usage: tsx ops/import-word-shares.ts <private-shares-json> <rdb-sha256> <expected-count>",
    );
  const info = await stat(sourcePath);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Source file must be private");
  const parsed = JSON.parse(await readFile(sourcePath, "utf8")) as unknown;
  if (!Array.isArray(parsed) || parsed.length !== expected)
    throw new Error("Word share count differs from preflight");
  const rows = parsed as SourceRow[];
  const sources = rows.map((row) => ({
    link: parseShare(row),
    hash: digest(JSON.stringify(row.value)),
  }));
  if (
    new Set(sources.map(({ link }) => link.id)).size !== sources.length ||
    new Set(sources.map(({ link }) => link.tokenHash)).size !== sources.length
  )
    throw new Error("Duplicate source share identity");

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{
      id: string;
      source_rdb_sha256: string | null;
      source_record_sha256: string | null;
    }>("select id, source_rdb_sha256, source_record_sha256 from word_share_links for update");
    if (existing.rows.length > sources.length) throw new Error("Target has extra word shares");
    for (const row of existing.rows) {
      const source = sources.find(({ link }) => link.id === row.id);
      if (!source || row.source_rdb_sha256 !== rdbHash || row.source_record_sha256 !== source.hash)
        throw new Error("Target has runtime or conflicting word share data");
    }
    for (const { link, hash } of sources) {
      if (existing.rows.some(({ id }) => id === link.id)) continue;
      await client.query(
        `insert into word_share_links
           (id, slug, token_hash, expires_at, pin_required, pin_hash, pin_updated_at,
            revoked_at, created_at, updated_at, created_by_role, revision,
            source_rdb_sha256, source_record_sha256)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13)`,
        [
          link.id,
          link.slug,
          link.tokenHash,
          link.expiresAt,
          link.pinRequired,
          link.pinHash ?? null,
          link.pinUpdatedAt ?? null,
          link.revokedAt ?? null,
          link.createdAt,
          link.updatedAt,
          link.createdByRole,
          rdbHash,
          hash,
        ],
      );
    }
    await client.query("commit");
    console.log(`word_shares=${sources.length}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
