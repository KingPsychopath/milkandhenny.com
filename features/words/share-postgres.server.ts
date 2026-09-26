import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import type { ShareLink } from "./content-types";

type ShareRow = {
  id: string;
  slug: string;
  token_hash: string;
  expires_at: Date;
  pin_required: boolean;
  pin_hash: string | null;
  pin_updated_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by_role: "admin";
  revision: number;
};

const COLUMNS = `id, slug, token_hash, expires_at, pin_required, pin_hash,
  pin_updated_at, revoked_at, created_at, updated_at, created_by_role, revision`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fromRow(row: ShareRow): ShareLink {
  return {
    id: row.id,
    slug: row.slug,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at.toISOString(),
    pinRequired: row.pin_required,
    ...(row.pin_hash !== null ? { pinHash: row.pin_hash } : {}),
    ...(row.pin_updated_at ? { pinUpdatedAt: row.pin_updated_at.toISOString() } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdByRole: row.created_by_role,
    revision: row.revision,
  };
}

export class ShareRevisionConflictError extends Error {
  constructor() {
    super("This share link changed while you were editing it. Reload and try again.");
    this.name = "ShareRevisionConflictError";
  }
}

export async function readPostgresShare(id: string): Promise<ShareLink | null> {
  if (!UUID.test(id)) return null;
  const row = await queryOne<ShareRow>(`select ${COLUMNS} from word_share_links where id = $1`, [
    id,
  ]);
  return row ? fromRow(row) : null;
}

export async function findPostgresShareByTokenHash(
  slug: string,
  tokenHash: string,
): Promise<ShareLink | null> {
  const row = await queryOne<ShareRow>(
    `select ${COLUMNS} from word_share_links where slug = $1 and token_hash = $2`,
    [slug, tokenHash],
  );
  return row ? fromRow(row) : null;
}

export async function listPostgresShares(slug: string): Promise<ShareLink[]> {
  const rows = await query<ShareRow>(
    `select ${COLUMNS} from word_share_links where slug = $1 order by created_at desc, id`,
    [slug],
  );
  return rows.map(fromRow);
}

export async function listPostgresShareSlugs(): Promise<string[]> {
  const rows = await query<{ slug: string }>(
    "select distinct slug from word_share_links order by slug",
  );
  return rows.map(({ slug }) => slug);
}

export async function savePostgresShare(link: ShareLink): Promise<ShareLink> {
  return transaction(async (client) => {
    const current = await client.query<{ revision: number }>(
      "select revision from word_share_links where id = $1 for update",
      [link.id],
    );
    const existing = current.rows[0];
    if (existing ? link.revision !== existing.revision : link.revision !== undefined)
      throw new ShareRevisionConflictError();
    const revision = existing ? existing.revision + 1 : 1;
    const values = [
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
      revision,
    ];
    const result = existing
      ? await client.query(
          `update word_share_links set slug=$2, token_hash=$3, expires_at=$4,
             pin_required=$5, pin_hash=$6, pin_updated_at=$7, revoked_at=$8,
             created_at=$9, updated_at=$10, created_by_role=$11, revision=$12,
             source_rdb_sha256=null, source_record_sha256=null
           where id=$1 and revision=$13`,
          [...values, existing.revision],
        )
      : await client.query(
          `insert into word_share_links (${COLUMNS})
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           on conflict (id) do nothing`,
          values,
        );
    if (result.rowCount !== 1) throw new ShareRevisionConflictError();
    return { ...link, revision };
  });
}

export async function cleanupPostgresSharesForSlug(slug: string, nowMs: number) {
  return transaction(async (client) => {
    const result = await client.query<{
      id: string;
      expires_at: Date;
      revoked_at: Date | null;
    }>("select id, expires_at, revoked_at from word_share_links where slug = $1 for update", [
      slug,
    ]);
    const removedRevoked = result.rows.filter((row) => row.revoked_at !== null);
    const removedExpired = result.rows.filter(
      (row) => row.revoked_at === null && row.expires_at.getTime() <= nowMs,
    );
    const ids = [...removedRevoked, ...removedExpired].map(({ id }) => id);
    if (ids.length)
      await client.query("delete from word_share_links where id = any($1::uuid[])", [ids]);
    return {
      slug,
      scanned: result.rows.length,
      removedExpired: removedExpired.length,
      removedRevoked: removedRevoked.length,
      staleIndexRemoved: 0,
      remaining: result.rows.length - ids.length,
    };
  });
}

export async function deletePostgresSharesForSlug(slug: string): Promise<number> {
  const rows = await query<{ id: string }>(
    "delete from word_share_links where slug = $1 returning id",
    [slug],
  );
  return rows.length;
}
