import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { log } from "@/lib/platform/logger.server";
import {
  getPitchDraftExpiresAt,
  getPitchMaxDecksPerEmail,
  getPitchMaxSlides,
  PITCH_BACKUP_INTERVAL_MS,
  PITCH_BACKUP_KEEP_COUNT,
  PITCH_MUTATION_RETENTION_DAYS,
} from "./config.server";
import { mergePitchDocuments } from "./merge";
import type {
  PitchAsset,
  PitchAssetKind,
  PitchAssetState,
  PitchDeckAdminSummary,
  PitchDeckLifecycle,
  PitchDocument,
  PublicPitchDeck,
} from "./types";
import { parsePitchDocument } from "./validation";

interface PitchDeckRow extends QueryResultRow {
  id: string;
  create_request_id: string;
  owner_name: string;
  owner_email: string;
  owner_email_hash: string;
  title: string;
  lifecycle: PitchDeckLifecycle;
  draft_document: unknown;
  draft_version: string | number;
  published_document: unknown | null;
  published_version: string | number | null;
  published_title: string | null;
  thumbnail_asset_id: string | null;
  last_mutation_id: string | null;
  last_backup_at: Date | string | null;
  draft_expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
  archived_at: Date | string | null;
}

export interface PitchAssetRow extends QueryResultRow {
  id: string;
  deck_id: string;
  object_key: string;
  file_id: string | null;
  kind: PitchAssetKind;
  state: PitchAssetState;
  file_name: string;
  mime_type: string;
  bytes: string | number;
  created_at: Date | string;
  ready_at: Date | string | null;
  published_at: Date | string | null;
}

export interface StoredPitchDeck {
  id: string;
  ownerName: string;
  ownerEmail: string;
  title: string;
  lifecycle: PitchDeckLifecycle;
  draftDocument: PitchDocument;
  draftVersion: number;
  publishedDocument?: PitchDocument;
  publishedVersion?: number;
  thumbnailAssetId?: string;
  draftExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  archivedAt?: string;
}

export interface PitchDeckBackup {
  id: string;
  version: number;
  reason: "periodic" | "conflict" | "publish" | "admin";
  createdAt: string;
}

export interface PitchAuditEvent {
  id: string;
  action: string;
  actor: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type PitchStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: Date | string | null): string | undefined {
  return value ? iso(value) : undefined;
}

function integer(value: string | number | null | undefined): number {
  return typeof value === "number" ? value : Number.parseInt(value ?? "0", 10);
}

export function normalisePitchEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function hashPitchValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPitchDeckId(): string {
  return `p_${randomBytes(16).toString("base64url")}`;
}

export function createPitchAssetId(): string {
  return `pa_${randomBytes(16).toString("base64url")}`;
}

export function createPitchOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

function parseStoredDocument(value: unknown): PitchDocument {
  const parsed = parsePitchDocument(value, getPitchMaxSlides());
  if (!parsed.ok) throw new Error(`Stored pitch document is invalid: ${parsed.error}`);
  return parsed.document;
}

function toStoredDeck(row: PitchDeckRow): StoredPitchDeck {
  return {
    id: row.id,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    title: row.title,
    lifecycle: row.lifecycle,
    draftDocument: parseStoredDocument(row.draft_document),
    draftVersion: integer(row.draft_version),
    publishedDocument: row.published_document
      ? parseStoredDocument(row.published_document)
      : undefined,
    publishedVersion: row.published_version === null ? undefined : integer(row.published_version),
    thumbnailAssetId: row.thumbnail_asset_id ?? undefined,
    draftExpiresAt: iso(row.draft_expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: optionalIso(row.published_at),
    archivedAt: optionalIso(row.archived_at),
  };
}

export function toPitchAsset(row: PitchAssetRow): PitchAsset {
  return {
    id: row.id,
    deckId: row.deck_id,
    fileId: row.file_id ?? undefined,
    kind: row.kind,
    state: row.state,
    fileName: row.file_name,
    mimeType: row.mime_type,
    bytes: integer(row.bytes),
    createdAt: iso(row.created_at),
    readyAt: optionalIso(row.ready_at),
  };
}

async function clientDeck(client: PoolClient, deckId: string, lock = false) {
  const result = await client.query<PitchDeckRow>(
    `select * from pitch_decks where id = $1 ${lock ? "for update" : ""}`,
    [deckId],
  );
  return result.rows[0] ?? null;
}

async function clientOwnsDeck(client: PoolClient, deckId: string, ownerToken: string) {
  const tokenHash = hashPitchValue(ownerToken);
  const result = await client.query<{ id: string }>(
    `select id from pitch_access_tokens
      where deck_id = $1 and token_hash = $2 and revoked_at is null
      limit 1`,
    [deckId, tokenHash],
  );
  if (result.rows[0]) {
    await client.query(`update pitch_access_tokens set last_used_at = now() where id = $1`, [
      result.rows[0].id,
    ]);
  }
  return Boolean(result.rows[0]);
}

async function insertAudit(
  client: PoolClient,
  input: {
    deckId: string;
    action: string;
    actor: string;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `insert into pitch_audit_events (deck_id, action, actor, metadata)
      values ($1,$2,$3,$4::jsonb)`,
    [input.deckId, input.action, input.actor, JSON.stringify(input.metadata ?? {})],
  );
}

export async function recordPitchAudit(input: {
  deckId: string;
  action: string;
  actor: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await transaction((client) => insertAudit(client, input));
}

export async function createPitchDeck(input: {
  createRequestId: string;
  ownerName: string;
  ownerEmail: string;
  ownerToken: string;
  title: string;
  document: PitchDocument;
}): Promise<PitchStoreResult<{ deck: StoredPitchDeck; duplicate: boolean }>> {
  const email = normalisePitchEmail(input.ownerEmail);
  const emailHash = hashPitchValue(email);
  const ownerTokenHash = hashPitchValue(input.ownerToken);

  return transaction(async (client) => {
    const duplicate = await client.query<PitchDeckRow>(
      `select d.* from pitch_decks d
        join pitch_access_tokens t on t.deck_id = d.id
        where d.create_request_id = $1 and t.token_hash = $2 and t.revoked_at is null
        limit 1`,
      [input.createRequestId, ownerTokenHash],
    );
    if (duplicate.rows[0]) {
      return { ok: true, value: { deck: toStoredDeck(duplicate.rows[0]), duplicate: true } };
    }

    // Concurrent creates for the same address share the same transaction lock,
    // so the per-owner cap cannot be raced.
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [emailHash]);
    const count = await client.query<{ count: string }>(
      `select count(*)::text as count from pitch_decks
        where owner_email_hash = $1 and lifecycle = 'active'`,
      [emailHash],
    );
    if (integer(count.rows[0]?.count) >= getPitchMaxDecksPerEmail()) {
      return {
        ok: false,
        status: 409,
        error: `You can keep up to ${getPitchMaxDecksPerEmail()} active pitches at once`,
      };
    }

    const deckId = createPitchDeckId();
    const inserted = await client.query<PitchDeckRow>(
      `insert into pitch_decks (
         id, create_request_id, owner_name, owner_email, owner_email_hash,
         title, draft_document, draft_expires_at
       ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       returning *`,
      [
        deckId,
        input.createRequestId,
        input.ownerName,
        email,
        emailHash,
        input.title,
        JSON.stringify(input.document),
        getPitchDraftExpiresAt(),
      ],
    );
    await client.query(
      `insert into pitch_access_tokens (id, deck_id, token_hash, label)
        values ($1,$2,$3,'first device')`,
      [randomUUID(), deckId, ownerTokenHash],
    );
    await insertAudit(client, {
      deckId,
      action: "deck.created",
      actor: "owner",
      metadata: { slides: input.document.slides.filter((slide) => !slide.deletedAt).length },
    });
    return {
      ok: true,
      value: { deck: toStoredDeck(inserted.rows[0]), duplicate: false },
    };
  });
}

export async function readOwnedPitchDeck(
  deckId: string,
  ownerToken: string,
): Promise<PitchStoreResult<StoredPitchDeck>> {
  return transaction(async (client) => {
    if (!(await clientOwnsDeck(client, deckId, ownerToken))) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    const row = await clientDeck(client, deckId);
    if (!row || row.lifecycle === "deleting") {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    return { ok: true, value: toStoredDeck(row) };
  });
}

async function maybeBackup(
  client: PoolClient,
  row: PitchDeckRow,
  reason: "periodic" | "conflict" | "publish" | "admin",
) {
  const lastBackupAt = row.last_backup_at ? new Date(row.last_backup_at).getTime() : 0;
  const due = Date.now() - lastBackupAt >= PITCH_BACKUP_INTERVAL_MS;
  if (reason === "periodic" && !due) return;
  await client.query(
    `insert into pitch_deck_backups (deck_id, version, reason, document)
      values ($1,$2,$3,$4::jsonb)`,
    [row.id, integer(row.draft_version), reason, JSON.stringify(row.draft_document)],
  );
  await client.query(
    `delete from pitch_deck_backups
      where id in (
        select id from pitch_deck_backups
          where deck_id = $1
          order by created_at desc, id desc
          offset $2
      )`,
    [row.id, PITCH_BACKUP_KEEP_COUNT],
  );
}

export async function syncPitchDeck(input: {
  deckId: string;
  ownerToken: string;
  baseVersion: number;
  mutationId: string;
  title: string;
  document: PitchDocument;
}): Promise<PitchStoreResult<{ deck: StoredPitchDeck; merged: boolean; duplicate: boolean }>> {
  return transaction(async (client) => {
    if (!(await clientOwnsDeck(client, input.deckId, input.ownerToken))) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    const row = await clientDeck(client, input.deckId, true);
    if (!row || row.lifecycle !== "active") {
      return { ok: false, status: 409, error: "This pitch can no longer be edited" };
    }

    const seen = await client.query<{ version: string | number }>(
      `select version from pitch_mutations where deck_id = $1 and mutation_id = $2`,
      [input.deckId, input.mutationId],
    );
    if (seen.rows[0]) {
      return {
        ok: true,
        value: { deck: toStoredDeck(row), merged: false, duplicate: true },
      };
    }

    const currentVersion = integer(row.draft_version);
    const merged = input.baseVersion !== currentVersion;
    const document = merged
      ? mergePitchDocuments(parseStoredDocument(row.draft_document), input.document)
      : input.document;
    const parsed = parsePitchDocument(document, getPitchMaxSlides());
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

    await maybeBackup(client, row, merged ? "conflict" : "periodic");
    const nextVersion = currentVersion + 1;
    const updated = await client.query<PitchDeckRow>(
      `update pitch_decks
        set title = $2,
            draft_document = $3::jsonb,
            draft_version = $4,
            last_mutation_id = $5,
            last_backup_at = case
              when last_backup_at is null or last_backup_at < now() - interval '5 minutes'
                then now()
              else last_backup_at
            end,
            draft_expires_at = $6,
            updated_at = now()
        where id = $1
        returning *`,
      [
        input.deckId,
        input.title,
        JSON.stringify(parsed.document),
        nextVersion,
        input.mutationId,
        getPitchDraftExpiresAt(),
      ],
    );
    await client.query(
      `insert into pitch_mutations (deck_id, mutation_id, version) values ($1,$2,$3)`,
      [input.deckId, input.mutationId, nextVersion],
    );
    if (merged) {
      await insertAudit(client, {
        deckId: input.deckId,
        action: "draft.consolidated",
        actor: "owner",
        metadata: { baseVersion: input.baseVersion, currentVersion, nextVersion },
      });
    }
    return {
      ok: true,
      value: { deck: toStoredDeck(updated.rows[0]), merged, duplicate: false },
    };
  });
}

export async function publishPitchDeck(input: {
  deckId: string;
  ownerToken: string;
  thumbnailAssetId?: string;
}): Promise<PitchStoreResult<StoredPitchDeck>> {
  return transaction(async (client) => {
    if (!(await clientOwnsDeck(client, input.deckId, input.ownerToken))) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    const row = await clientDeck(client, input.deckId, true);
    if (!row || row.lifecycle !== "active") {
      return { ok: false, status: 409, error: "This pitch cannot be published" };
    }
    if (input.thumbnailAssetId) {
      const thumbnail = await client.query<{ id: string }>(
        `select id from pitch_assets
          where id = $1 and deck_id = $2 and kind = 'thumbnail' and state = 'ready'`,
        [input.thumbnailAssetId, input.deckId],
      );
      if (!thumbnail.rows[0]) {
        return { ok: false, status: 400, error: "The cover image is not ready" };
      }
    }

    const document = parseStoredDocument(row.draft_document);
    const referencedAssets = new Set(
      document.slides.flatMap((slide) => [
        ...Object.values(slide.assetIds),
        ...slide.audioCues.map((cue) => cue.assetId),
      ]),
    );
    if (referencedAssets.size > 0) {
      const ready = await client.query<{ id: string }>(
        `select id from pitch_assets
          where deck_id = $1 and state = 'ready' and id = any($2::text[])`,
        [input.deckId, [...referencedAssets]],
      );
      if (ready.rows.length !== referencedAssets.size) {
        return {
          ok: false,
          status: 409,
          error: "Wait for every image and sound to finish uploading",
        };
      }
    }

    await maybeBackup(client, row, "publish");
    const updated = await client.query<PitchDeckRow>(
      `update pitch_decks
        set published_document = draft_document,
            published_version = draft_version,
            published_title = title,
            published_at = now(),
            thumbnail_asset_id = coalesce($2, thumbnail_asset_id),
            draft_expires_at = $3,
            last_backup_at = now(),
            updated_at = now()
        where id = $1
        returning *`,
      [input.deckId, input.thumbnailAssetId ?? null, getPitchDraftExpiresAt()],
    );
    await client.query(
      `update pitch_assets set published_at = coalesce(published_at, now())
        where deck_id = $1 and state = 'ready' and id = any($2::text[])`,
      [
        input.deckId,
        [...referencedAssets, ...(input.thumbnailAssetId ? [input.thumbnailAssetId] : [])],
      ],
    );
    await insertAudit(client, {
      deckId: input.deckId,
      action: "deck.published",
      actor: "owner",
      metadata: { version: integer(row.draft_version) },
    });
    return { ok: true, value: toStoredDeck(updated.rows[0]) };
  });
}

export async function listReadyPitchAssets(deckId: string): Promise<PitchAssetRow[]> {
  return query<PitchAssetRow>(
    `select * from pitch_assets where deck_id = $1 and state = 'ready' order by created_at`,
    [deckId],
  );
}

export async function getReadyPitchAsset(
  deckId: string,
  assetId: string,
): Promise<PitchAssetRow | null> {
  return queryOne<PitchAssetRow>(
    `select * from pitch_assets where deck_id = $1 and id = $2 and state = 'ready'`,
    [deckId, assetId],
  );
}

export async function getPitchAsset(
  deckId: string,
  assetId: string,
): Promise<PitchAssetRow | null> {
  return queryOne<PitchAssetRow>(`select * from pitch_assets where deck_id = $1 and id = $2`, [
    deckId,
    assetId,
  ]);
}

export async function listPitchAssets(deckId: string): Promise<PitchAssetRow[]> {
  return query<PitchAssetRow>(`select * from pitch_assets where deck_id = $1 order by created_at`, [
    deckId,
  ]);
}

export async function listStalePendingPitchAssets(limit = 100): Promise<PitchAssetRow[]> {
  return query<PitchAssetRow>(
    `select * from pitch_assets
      where state = 'pending' and created_at < now() - interval '1 hour'
      order by created_at, id
      limit $1`,
    [Math.min(500, Math.max(1, limit))],
  );
}

export async function listPublicPitchDecks(
  search?: string,
  limit = 60,
): Promise<PublicPitchDeck[]> {
  const term = search?.trim() ? `%${search.trim()}%` : null;
  const rows = await query<
    QueryResultRow & {
      id: string;
      title: string;
      owner_name: string;
      published_at: Date | string;
      updated_at: Date | string;
      published_document: unknown;
      thumbnail_asset_id: string | null;
    }
  >(
    `select id, coalesce(published_title, title) as title, owner_name, published_at, updated_at,
            published_document, thumbnail_asset_id
      from pitch_decks
      where published_at is not null
        and lifecycle = 'active'
        and (
          $1::text is null
          or coalesce(published_title, title) ilike $1
          or owner_name ilike $1
        )
      order by published_at desc, id
      limit $2`,
    [term, Math.min(100, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    ownerName: row.owner_name,
    publishedAt: iso(row.published_at),
    updatedAt: iso(row.published_at),
    slideCount: parseStoredDocument(row.published_document).slides.filter(
      (slide) => !slide.deletedAt,
    ).length,
    thumbnailUrl: row.thumbnail_asset_id ?? undefined,
  }));
}

export async function readPublicPitchDeck(deckId: string): Promise<StoredPitchDeck | null> {
  const row = await queryOne<PitchDeckRow>(
    `select * from pitch_decks
      where id = $1 and lifecycle = 'active' and published_at is not null`,
    [deckId],
  );
  return row
    ? {
        ...toStoredDeck(row),
        title: row.published_title ?? row.title,
      }
    : null;
}

export async function insertPitchAsset(input: {
  id: string;
  deckId: string;
  objectKey: string;
  fileId?: string;
  kind: PitchAssetKind;
  fileName: string;
  mimeType: string;
  bytes: number;
}): Promise<PitchAssetRow> {
  const rows = await query<PitchAssetRow>(
    `insert into pitch_assets (
       id, deck_id, object_key, file_id, kind, file_name, mime_type, bytes
     ) values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning *`,
    [
      input.id,
      input.deckId,
      input.objectKey,
      input.fileId ?? null,
      input.kind,
      input.fileName,
      input.mimeType,
      input.bytes,
    ],
  );
  return rows[0];
}

export async function markPitchAssetReady(assetId: string): Promise<PitchAssetRow | null> {
  return queryOne<PitchAssetRow>(
    `update pitch_assets
      set state = 'ready', ready_at = now()
      where id = $1 and state = 'pending'
      returning *`,
    [assetId],
  );
}

export async function deletePitchAssetRecord(assetId: string): Promise<void> {
  await query(`delete from pitch_assets where id = $1`, [assetId]);
}

export async function pitchAssetBytes(deckId: string): Promise<number> {
  const row = await queryOne<{ bytes: string }>(
    `select coalesce(sum(bytes),0)::text as bytes
      from pitch_assets
      where deck_id = $1
        and (state = 'ready' or created_at > now() - interval '1 hour')`,
    [deckId],
  );
  return integer(row?.bytes);
}

export async function ownerCanAccessPitch(deckId: string, ownerToken: string): Promise<boolean> {
  const tokenHash = hashPitchValue(ownerToken);
  const row = await queryOne<{ exists: boolean }>(
    `select exists(
       select 1 from pitch_access_tokens t
       join pitch_decks d on d.id = t.deck_id
       where t.deck_id = $1 and t.token_hash = $2 and t.revoked_at is null
         and d.lifecycle = 'active'
     ) as exists`,
    [deckId, tokenHash],
  );
  return row?.exists === true;
}

export async function listPitchDecksForRecovery(email: string): Promise<StoredPitchDeck[]> {
  const rows = await query<PitchDeckRow>(
    `select * from pitch_decks
      where owner_email_hash = $1 and lifecycle = 'active'
      order by updated_at desc
      limit 10`,
    [hashPitchValue(normalisePitchEmail(email))],
  );
  return rows.map(toStoredDeck);
}

export async function addPitchAccessTokens(
  entries: Array<{ deckId: string; token: string; label: string; actor?: string }>,
): Promise<void> {
  await transaction(async (client) => {
    for (const entry of entries) {
      await client.query(
        `insert into pitch_access_tokens (id, deck_id, token_hash, label)
          values ($1,$2,$3,$4)`,
        [randomUUID(), entry.deckId, hashPitchValue(entry.token), entry.label],
      );
      await insertAudit(client, {
        deckId: entry.deckId,
        action: "access.issued",
        actor: entry.actor ?? "recovery",
      });
      await client.query(
        `update pitch_access_tokens
          set revoked_at = now()
          where id in (
            select id from pitch_access_tokens
              where deck_id = $1 and revoked_at is null
              order by created_at desc, id desc
              offset 8
          )`,
        [entry.deckId],
      );
    }
  });
}

export async function removePitchAccessTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await query(`delete from pitch_access_tokens where token_hash = any($1::text[])`, [
    tokens.map(hashPitchValue),
  ]);
}

export async function listPitchDecksForAdmin(): Promise<PitchDeckAdminSummary[]> {
  const rows = await query<
    QueryResultRow & {
      id: string;
      title: string;
      owner_name: string;
      owner_email: string;
      lifecycle: PitchDeckLifecycle;
      draft_document: unknown;
      published_document: unknown | null;
      draft_version: string | number;
      published_version: string | number | null;
      asset_count: string;
      asset_bytes: string;
      created_at: Date | string;
      updated_at: Date | string;
      published_at: Date | string | null;
      draft_expires_at: Date | string;
    }
  >(
    `select d.*,
            count(a.id)::text as asset_count,
            coalesce(sum(a.bytes),0)::text as asset_bytes
      from pitch_decks d
      left join pitch_assets a on a.deck_id = d.id
      where d.lifecycle <> 'deleting'
      group by d.id
      order by d.updated_at desc
      limit 500`,
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    ownerName: row.owner_name,
    ownerEmail: row.owner_email,
    lifecycle: row.lifecycle,
    slideCount: parseStoredDocument(row.draft_document).slides.filter((slide) => !slide.deletedAt)
      .length,
    publishedSlideCount: row.published_document
      ? parseStoredDocument(row.published_document).slides.filter((slide) => !slide.deletedAt)
          .length
      : 0,
    version: integer(row.draft_version),
    publishedVersion: row.published_version === null ? undefined : integer(row.published_version),
    assetCount: integer(row.asset_count),
    assetBytes: integer(row.asset_bytes),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: optionalIso(row.published_at),
    draftExpiresAt: iso(row.draft_expires_at),
  }));
}

export async function readPitchDeckForAdmin(deckId: string): Promise<StoredPitchDeck | null> {
  const row = await queryOne<PitchDeckRow>(
    `select * from pitch_decks where id = $1 and lifecycle <> 'deleting'`,
    [deckId],
  );
  return row ? toStoredDeck(row) : null;
}

export async function listPitchBackupsForAdmin(deckId: string): Promise<PitchDeckBackup[]> {
  const rows = await query<
    QueryResultRow & {
      id: string | number;
      version: string | number;
      reason: PitchDeckBackup["reason"];
      created_at: Date | string;
    }
  >(
    `select id, version, reason, created_at
      from pitch_deck_backups
      where deck_id = $1
      order by created_at desc, id desc
      limit 20`,
    [deckId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    version: integer(row.version),
    reason: row.reason,
    createdAt: iso(row.created_at),
  }));
}

export async function listPitchAuditForAdmin(deckId: string): Promise<PitchAuditEvent[]> {
  const rows = await query<
    QueryResultRow & {
      id: string | number;
      action: string;
      actor: string;
      metadata: unknown;
      created_at: Date | string;
    }
  >(
    `select id, action, actor, metadata, created_at
      from pitch_audit_events
      where deck_id = $1
      order by created_at desc, id desc
      limit 50`,
    [deckId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    action: row.action,
    actor: row.actor,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    createdAt: iso(row.created_at),
  }));
}

export async function updatePitchDeckForAdmin(input: {
  deckId: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
}): Promise<StoredPitchDeck | null> {
  return transaction(async (client) => {
    const email = normalisePitchEmail(input.ownerEmail);
    const current = await clientDeck(client, input.deckId, true);
    if (!current || current.lifecycle === "deleting") return null;
    const ownerChanged = current.owner_email_hash !== hashPitchValue(email);
    const rows = await client.query<PitchDeckRow>(
      `update pitch_decks
        set title = $2,
            published_title = case when published_at is null then null else $2 end,
            owner_name = $3,
            owner_email = $4,
            owner_email_hash = $5,
            updated_at = now()
        where id = $1 and lifecycle <> 'deleting'
        returning *`,
      [input.deckId, input.title, input.ownerName, email, hashPitchValue(email)],
    );
    if (ownerChanged) {
      await client.query(
        `update pitch_access_tokens
          set revoked_at = now()
          where deck_id = $1 and revoked_at is null`,
        [input.deckId],
      );
    }
    await insertAudit(client, {
      deckId: input.deckId,
      action: "deck.metadata.updated",
      actor: "admin",
      metadata: { ownerChanged, accessRevoked: ownerChanged },
    });
    return toStoredDeck(rows.rows[0]);
  });
}

export async function restorePitchBackupForAdmin(
  deckId: string,
  backupId: string,
): Promise<StoredPitchDeck | null> {
  return transaction(async (client) => {
    const row = await clientDeck(client, deckId, true);
    if (!row || row.lifecycle === "deleting") return null;
    const backup = await client.query<QueryResultRow & { id: string | number; document: unknown }>(
      `select id, document from pitch_deck_backups where id = $1 and deck_id = $2`,
      [backupId, deckId],
    );
    if (!backup.rows[0]) return null;
    const document = parseStoredDocument(backup.rows[0].document);
    await maybeBackup(client, row, "admin");
    const updated = await client.query<PitchDeckRow>(
      `update pitch_decks
        set draft_document = $2::jsonb,
            draft_version = draft_version + 1,
            last_mutation_id = null,
            last_backup_at = now(),
            draft_expires_at = $3,
            updated_at = now()
        where id = $1
        returning *`,
      [deckId, JSON.stringify(document), getPitchDraftExpiresAt()],
    );
    await insertAudit(client, {
      deckId,
      action: "backup.restored",
      actor: "admin",
      metadata: { backupId },
    });
    return toStoredDeck(updated.rows[0]);
  });
}

export async function markPitchDeckDeletingForAdmin(
  deckId: string,
  confirmation: string,
): Promise<PitchStoreResult<StoredPitchDeck>> {
  return transaction(async (client) => {
    const current = await clientDeck(client, deckId, true);
    if (!current || current.lifecycle === "deleting") {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    if (confirmation !== current.title) {
      return { ok: false, status: 400, error: "Type the exact pitch title" };
    }
    const rows = await client.query<PitchDeckRow>(
      `update pitch_decks
        set lifecycle = 'deleting', updated_at = now()
        where id = $1
        returning *`,
      [deckId],
    );
    await insertAudit(client, {
      deckId,
      action: "deck.delete.requested",
      actor: "admin",
    });
    return { ok: true, value: toStoredDeck(rows.rows[0]) };
  });
}

export async function setPitchDeckArchived(
  deckId: string,
  archived: boolean,
): Promise<StoredPitchDeck | null> {
  return transaction(async (client) => {
    const rows = await client.query<PitchDeckRow>(
      `update pitch_decks
        set lifecycle = $2,
            archived_at = case when $2 = 'archived' then now() else null end,
            updated_at = now()
        where id = $1 and lifecycle <> 'deleting'
        returning *`,
      [deckId, archived ? "archived" : "active"],
    );
    if (!rows.rows[0]) return null;
    await insertAudit(client, {
      deckId,
      action: archived ? "deck.archived" : "deck.restored",
      actor: "admin",
    });
    return toStoredDeck(rows.rows[0]);
  });
}

export async function markExpiredPitchDecksDeleting(limit = 100): Promise<StoredPitchDeck[]> {
  return transaction(async (client) => {
    const rows = await client.query<PitchDeckRow>(
      `with candidates as (
         select id from pitch_decks
          where (
            lifecycle = 'deleting'
            or (
              lifecycle = 'active'
              and published_at is null
              and draft_expires_at <= now()
            )
          )
          order by draft_expires_at, id
          for update skip locked
          limit $1
       )
       update pitch_decks d
         set lifecycle = 'deleting', updated_at = now()
         from candidates c
         where d.id = c.id
         returning d.*`,
      [Math.min(500, Math.max(1, limit))],
    );
    return rows.rows.map(toStoredDeck);
  });
}

export async function hardDeletePitchDeck(deckId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `delete from pitch_decks where id = $1 and lifecycle = 'deleting' returning id`,
    [deckId],
  );
  if (rows[0]) {
    log.info("pitches.cleanup", "Deleted abandoned pitch", { deckId });
  }
  return Boolean(rows[0]);
}

export async function prunePitchMutations(limit = 1_000): Promise<number> {
  const rows = await query<{ mutation_id: string }>(
    `with expired as (
       select deck_id, mutation_id
         from pitch_mutations
        where created_at < now() - ($1 * interval '1 day')
        order by created_at, deck_id, mutation_id
        limit $2
     )
     delete from pitch_mutations mutation
      using expired
      where mutation.deck_id = expired.deck_id
        and mutation.mutation_id = expired.mutation_id
      returning mutation.mutation_id`,
    [PITCH_MUTATION_RETENTION_DAYS, Math.min(5_000, Math.max(1, limit))],
  );
  return rows.length;
}
