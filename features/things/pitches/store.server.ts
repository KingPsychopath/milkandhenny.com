import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { log } from "@/lib/platform/logger.server";
import { hasPitchDocumentContent, pitchDocumentContentCount } from "./document-content";
import {
  getPitchDraftExpiresAt,
  getPitchMaxDecksPerEmail,
  getPitchMaxSlides,
  PITCH_BACKUP_INTERVAL_MS,
  PITCH_BACKUP_KEEP_COUNT,
  PITCH_COMMAND_RETENTION_DAYS,
  PITCH_PUBLISHED_BACKUP_KEEP_COUNT,
  PITCH_TRASH_RETENTION_DAYS,
} from "./config.server";
import { mergePitchDocuments } from "./merge";
import type {
  PitchAsset,
  PitchAssetKind,
  PitchAssetState,
  PitchDeckAdminSummary,
  PitchDeckLifecycle,
  PitchCommandOperation,
  PitchDocument,
  PitchEdition,
  PitchVersionHistoryItem,
  PitchVersionPreview,
  PitchVersionReason,
  PublicPitchDeck,
} from "./types";
import { parsePitchDocument, pitchDocumentSchemaVersion } from "./validation";

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
  current_edition_number: string | number | null;
  thumbnail_asset_id: string | null;
  last_backup_at: Date | string | null;
  draft_expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
  published_at: Date | string | null;
  archived_at: Date | string | null;
  trashed_at: Date | string | null;
  purge_after: Date | string | null;
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
  currentEditionNumber?: number;
  thumbnailAssetId?: string;
  draftExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  archivedAt?: string;
  trashedAt?: string;
  purgeAfter?: string;
}

export interface StoredPublicPitchDeck {
  id: string;
  title: string;
  ownerName: string;
  publishedDocument: PitchDocument;
  publishedVersion: number;
  currentEditionNumber: number;
  thumbnailAssetId?: string;
  publishedAt: string;
}

export type PitchDeckBackup = PitchVersionHistoryItem;

interface PitchBackupRow extends QueryResultRow {
  id: string | number;
  version: string | number;
  reason: PitchVersionReason;
  document: unknown;
  title: string;
  metadata: unknown;
  created_at: Date | string;
}

interface PitchEditionRow extends QueryResultRow {
  deck_id: string;
  edition_number: string | number;
  draft_version: string | number;
  title: string;
  owner_name: string;
  document: unknown;
  thumbnail_asset_id: string | null;
  published_at: Date | string;
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

function toPitchVersionHistoryItem(row: PitchBackupRow): PitchVersionHistoryItem {
  const document = parseStoredDocument(row.document);
  const metadataSource =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const metadata = Object.fromEntries(
    Object.entries(metadataSource).filter(
      (entry): entry is [string, string | number | boolean | null] =>
        entry[1] === null || ["string", "number", "boolean"].includes(typeof entry[1]),
    ),
  );
  return {
    id: String(row.id),
    version: integer(row.version),
    reason: row.reason,
    createdAt: iso(row.created_at),
    slideCount: document.slides.filter((slide) => !slide.deletedAt).length,
    contentCount: pitchDocumentContentCount(document),
    title: row.title,
    metadata,
  };
}

function toPitchEdition(row: PitchEditionRow): PitchEdition {
  return {
    deckId: row.deck_id,
    editionNumber: integer(row.edition_number),
    draftVersion: integer(row.draft_version),
    title: row.title,
    ownerName: row.owner_name,
    document: parseStoredDocument(row.document),
    thumbnailAssetId: row.thumbnail_asset_id ?? undefined,
    publishedAt: iso(row.published_at),
  };
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
    currentEditionNumber:
      row.current_edition_number === null ? undefined : integer(row.current_edition_number),
    thumbnailAssetId: row.thumbnail_asset_id ?? undefined,
    draftExpiresAt: iso(row.draft_expires_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: optionalIso(row.published_at),
    archivedAt: optionalIso(row.archived_at),
    trashedAt: optionalIso(row.trashed_at),
    purgeAfter: optionalIso(row.purge_after),
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
    if (!row || ["trashed", "deleting"].includes(row.lifecycle)) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    return { ok: true, value: toStoredDeck(row) };
  });
}

async function maybeBackup(client: PoolClient, row: PitchDeckRow, reason: PitchVersionReason) {
  const lastBackupAt = row.last_backup_at ? new Date(row.last_backup_at).getTime() : 0;
  const due = Date.now() - lastBackupAt >= PITCH_BACKUP_INTERVAL_MS;
  if (reason === "autosave" && !due) return;
  await client.query(
    `insert into pitch_deck_backups (deck_id, version, reason, document, title, metadata)
      select $1,$2,$3,$4::jsonb,$5,$6::jsonb
      where not exists (
        select 1 from pitch_deck_backups where deck_id = $1 and version = $2
      )`,
    [
      row.id,
      integer(row.draft_version),
      reason,
      JSON.stringify(row.draft_document),
      row.title,
      JSON.stringify({ publishedEdition: row.current_edition_number }),
    ],
  );
  await client.query(
    `update pitch_deck_backups
        set reason = $3::text
      where deck_id = $1 and version = $2
        and case reason
              when 'publish' then 5
              when 'restore' then 4
              when 'conflict' then 3
              when 'safety' then 2
              else 1
            end
            < case $3::text
                when 'publish' then 5
                when 'restore' then 4
                when 'conflict' then 3
                when 'safety' then 2
                else 1
              end`,
    [row.id, integer(row.draft_version), reason],
  );
  await client.query(
    `delete from pitch_deck_backups
      where id in (
        select id from (
          select id, reason,
                 row_number() over (
                   partition by (reason = 'publish')
                   order by created_at desc, id desc
                 ) as retained_rank
            from pitch_deck_backups
           where deck_id = $1
        ) retained
        where (reason = 'publish' and retained_rank > $3)
           or (reason <> 'publish' and retained_rank > $2)
      )`,
    [row.id, PITCH_BACKUP_KEEP_COUNT, PITCH_PUBLISHED_BACKUP_KEEP_COUNT],
  );
}

async function restorePitchBackup(
  client: PoolClient,
  row: PitchDeckRow,
  backupId: string,
  actor: "owner" | "admin",
): Promise<StoredPitchDeck | null> {
  const backup = await client.query<PitchBackupRow>(
    `select id, version, reason, document, title, metadata, created_at
      from pitch_deck_backups where id = $1 and deck_id = $2`,
    [backupId, row.id],
  );
  if (!backup.rows[0]) return null;
  const document = parseStoredDocument(backup.rows[0].document);
  const title = backup.rows[0].title;
  await maybeBackup(client, row, "restore");
  const updated = await client.query<PitchDeckRow>(
    `update pitch_decks
      set draft_document = $2::jsonb,
          title = $3,
          draft_version = draft_version + 1,
          last_backup_at = now(),
          draft_expires_at = $4,
          updated_at = now()
      where id = $1
      returning *`,
    [row.id, JSON.stringify(document), title, getPitchDraftExpiresAt()],
  );
  const commandId = `m_${randomBytes(16).toString("base64url")}`;
  const sequence = integer(updated.rows[0].draft_version);
  await client.query(
    `insert into pitch_commands (
       deck_id, command_id, device_id, first_sequence, last_sequence,
       base_version, result_version, operations, result_title, result_document
     ) values ($1,$2,'device_server_restore',$3,$3,$4,$5,$6::jsonb,$7,$8::jsonb)`,
    [
      row.id,
      commandId,
      sequence,
      integer(row.draft_version),
      integer(updated.rows[0].draft_version),
      JSON.stringify([
        {
          id: commandId,
          deviceId: "device_server_restore",
          sequence,
          kind: "history.restore",
          payload: { backupId },
          occurredAt: new Date().toISOString(),
        },
      ]),
      title,
      JSON.stringify(document),
    ],
  );
  await insertAudit(client, {
    deckId: row.id,
    action: "backup.restored",
    actor,
    metadata: {
      backupId,
      fromVersion: integer(row.draft_version),
      restoredVersion: integer(backup.rows[0].version),
    },
  });
  return toStoredDeck(updated.rows[0]);
}

export async function syncPitchDeck(input: {
  deckId: string;
  ownerToken: string;
  baseVersion: number;
  mutationId: string;
  title: string;
  document: PitchDocument;
  operations: PitchCommandOperation[];
}): Promise<PitchStoreResult<{ deck: StoredPitchDeck; merged: boolean; duplicate: boolean }>> {
  const firstOperation = input.operations[0];
  const validJournal =
    firstOperation &&
    input.mutationId === firstOperation.id &&
    input.operations.every(
      (operation, index) =>
        operation.deviceId === firstOperation.deviceId &&
        operation.sequence === firstOperation.sequence + index,
    );
  if (!validJournal) {
    return { ok: false, status: 400, error: "The local command journal is incomplete" };
  }
  return transaction(async (client) => {
    if (!(await clientOwnsDeck(client, input.deckId, input.ownerToken))) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    const row = await clientDeck(client, input.deckId, true);
    if (!row || row.lifecycle !== "active") {
      return { ok: false, status: 409, error: "This pitch can no longer be edited" };
    }

    const seen = await client.query<{ result_version: string | number }>(
      `select result_version from pitch_commands where deck_id = $1 and command_id = $2`,
      [input.deckId, input.mutationId],
    );
    if (seen.rows[0]) {
      return {
        ok: true,
        value: {
          deck: toStoredDeck(row),
          merged: integer(row.draft_version) !== integer(seen.rows[0].result_version),
          duplicate: true,
        },
      };
    }

    const currentVersion = integer(row.draft_version);
    const merged = input.baseVersion !== currentVersion;
    const currentDocument = parseStoredDocument(row.draft_document);
    const document = merged ? mergePitchDocuments(currentDocument, input.document) : input.document;
    const parsed = parsePitchDocument(document, getPitchMaxSlides());
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

    const losesContent =
      pitchDocumentContentCount(parsed.document) < pitchDocumentContentCount(currentDocument);
    const destructive = input.operations.some((operation) =>
      ["deck.replace", "slide.remove", "media.remove"].includes(operation.kind),
    );
    await maybeBackup(
      client,
      row,
      merged ? "conflict" : losesContent || destructive ? "safety" : "autosave",
    );
    const nextVersion = currentVersion + 1;
    const updated = await client.query<PitchDeckRow>(
      `update pitch_decks
        set title = $2,
            draft_document = $3::jsonb,
            draft_version = $4,
            last_backup_at = case
              when last_backup_at is null or last_backup_at < now() - interval '5 minutes'
                then now()
              else last_backup_at
            end,
            draft_expires_at = $5,
            updated_at = now()
        where id = $1
        returning *`,
      [
        input.deckId,
        input.title,
        JSON.stringify(parsed.document),
        nextVersion,
        getPitchDraftExpiresAt(),
      ],
    );
    const lastOperation = input.operations[input.operations.length - 1];
    await client.query(
      `insert into pitch_commands (
         deck_id, command_id, device_id, first_sequence, last_sequence,
         base_version, result_version, operations, result_title, result_document
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)`,
      [
        input.deckId,
        input.mutationId,
        firstOperation.deviceId,
        firstOperation.sequence,
        lastOperation.sequence,
        input.baseVersion,
        nextVersion,
        JSON.stringify(input.operations),
        input.title,
        JSON.stringify(parsed.document),
      ],
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
    if (!hasPitchDocumentContent(document)) {
      return { ok: false, status: 409, error: "Add something to a slide before publishing" };
    }
    const referencedAssets = new Set(
      document.slides.flatMap((slide) => [
        ...Object.values(slide.assetIds),
        ...slide.mediaClips.map((clip) => clip.assetId),
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
          error: "Wait for every image, sound and video to finish uploading",
        };
      }
    }

    await maybeBackup(client, row, "publish");
    const editionNumber = integer(row.current_edition_number) + 1;
    await client.query(
      `insert into pitch_editions (
         deck_id, edition_number, draft_version, title, owner_name, document,
         thumbnail_asset_id, published_at
       ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,now())`,
      [
        input.deckId,
        editionNumber,
        integer(row.draft_version),
        row.title,
        row.owner_name,
        JSON.stringify(document),
        input.thumbnailAssetId ?? row.thumbnail_asset_id,
      ],
    );
    await client.query(
      `update pitch_deck_backups
          set metadata = metadata || jsonb_build_object('editionNumber', $3::integer)
        where deck_id = $1 and version = $2`,
      [input.deckId, integer(row.draft_version), editionNumber],
    );
    const updated = await client.query<PitchDeckRow>(
      `update pitch_decks
        set published_document = draft_document,
            published_version = draft_version,
            published_title = title,
            published_at = now(),
            current_edition_number = $4,
            thumbnail_asset_id = coalesce($2, thumbnail_asset_id),
            draft_expires_at = $3,
            last_backup_at = now(),
            updated_at = now()
        where id = $1
        returning *`,
      [input.deckId, input.thumbnailAssetId ?? null, getPitchDraftExpiresAt(), editionNumber],
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
      metadata: { version: integer(row.draft_version), editionNumber },
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

export async function listUnreferencedPitchAssets(limit = 100): Promise<PitchAssetRow[]> {
  return query<PitchAssetRow>(
    `select a.* from pitch_assets a
      join pitch_decks d on d.id = a.deck_id
      where a.state = 'ready'
        and a.created_at < now() - interval '24 hours'
        and a.id is distinct from d.thumbnail_asset_id
        and position(a.id in d.draft_document::text) = 0
        and position(a.id in coalesce(d.published_document, '{}'::jsonb)::text) = 0
        and not exists (
          select 1 from pitch_editions e
          where e.deck_id = a.deck_id
            and (e.thumbnail_asset_id = a.id or position(a.id in e.document::text) > 0)
        )
        and not exists (
          select 1 from pitch_deck_backups b
          where b.deck_id = a.deck_id
            and position(a.id in b.document::text) > 0
        )
      order by a.created_at, a.id
      limit $1`,
    [Math.min(500, Math.max(1, limit))],
  );
}

export async function listPublicPitchDecks(
  search?: string,
  limit = 60,
): Promise<{ decks: PublicPitchDeck[]; rejectedCount: number }> {
  const term = search?.trim() ? `%${search.trim()}%` : null;
  const rows = await query<
    QueryResultRow & {
      id: string;
      title: string;
      owner_name: string;
      published_at: Date | string;
      updated_at: Date | string;
      document: unknown;
      thumbnail_asset_id: string | null;
    }
  >(
    `select deck.id, edition.title, edition.owner_name, edition.published_at,
            edition.published_at as updated_at, edition.document, edition.thumbnail_asset_id
      from pitch_decks deck
      join pitch_editions edition
        on edition.deck_id = deck.id
       and edition.edition_number = deck.current_edition_number
      where deck.lifecycle = 'active'
        and (
          $1::text is null
          or edition.title ilike $1
          or edition.owner_name ilike $1
        )
      order by edition.published_at desc, deck.id
      limit $2`,
    [term, Math.min(100, Math.max(1, limit))],
  );
  const decks: PublicPitchDeck[] = [];
  let rejectedCount = 0;
  for (const row of rows) {
    const parsed = parsePitchDocument(row.document, getPitchMaxSlides());
    if (!parsed.ok) {
      rejectedCount += 1;
      log.error("pitches.document", "Published pitch document could not be read", {
        deckId: row.id,
        location: "pitch_editions.document",
        schemaVersion: pitchDocumentSchemaVersion(row.document),
        reason: parsed.error,
      });
      continue;
    }
    decks.push({
      id: row.id,
      title: row.title,
      ownerName: row.owner_name,
      publishedAt: iso(row.published_at),
      updatedAt: iso(row.published_at),
      slideCount: parsed.document.slides.filter((slide) => !slide.deletedAt).length,
      thumbnailUrl: row.thumbnail_asset_id ?? undefined,
    });
  }
  return { decks, rejectedCount };
}

export async function readPublicPitchDeck(deckId: string): Promise<StoredPublicPitchDeck | null> {
  const row = await queryOne<PitchDeckRow>(
    `select * from pitch_decks
      where id = $1 and lifecycle = 'active' and published_at is not null`,
    [deckId],
  );
  if (!row?.current_edition_number) return null;
  const currentEditionNumber = integer(row.current_edition_number);
  const edition = await readPitchEdition(deckId, currentEditionNumber);
  if (!edition) return null;
  return {
    id: row.id,
    title: edition.title,
    ownerName: edition.ownerName,
    publishedDocument: edition.document,
    publishedVersion: edition.draftVersion,
    currentEditionNumber,
    thumbnailAssetId: edition.thumbnailAssetId,
    publishedAt: edition.publishedAt,
  };
}

export async function listPitchEditions(deckId: string): Promise<PitchEdition[]> {
  const rows = await query<PitchEditionRow>(
    `select deck_id, edition_number, draft_version, title, owner_name, document,
            thumbnail_asset_id, published_at
       from pitch_editions
      where deck_id = $1
      order by edition_number desc`,
    [deckId],
  );
  return rows.map(toPitchEdition);
}

export async function readPitchEdition(
  deckId: string,
  editionNumber: number,
): Promise<PitchEdition | null> {
  const row = await queryOne<PitchEditionRow>(
    `select edition.deck_id, edition.edition_number, edition.draft_version,
            edition.title, edition.owner_name, edition.document, edition.thumbnail_asset_id,
            edition.published_at
       from pitch_editions edition
       join pitch_decks deck on deck.id = edition.deck_id
      where edition.deck_id = $1 and edition.edition_number = $2
        and deck.lifecycle = 'active'`,
    [deckId, editionNumber],
  );
  return row ? toPitchEdition(row) : null;
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
      trashed_at: Date | string | null;
      purge_after: Date | string | null;
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
    trashedAt: optionalIso(row.trashed_at),
    purgeAfter: optionalIso(row.purge_after),
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
  const rows = await query<PitchBackupRow>(
    `select id, version, reason, document, title, metadata, created_at
      from pitch_deck_backups
      where deck_id = $1
      order by created_at desc, id desc
      limit $2`,
    [deckId, PITCH_BACKUP_KEEP_COUNT + PITCH_PUBLISHED_BACKUP_KEEP_COUNT],
  );
  return rows.map(toPitchVersionHistoryItem);
}

export async function listPitchBackupsForOwner(
  deckId: string,
  ownerToken: string,
): Promise<PitchStoreResult<PitchDeckBackup[]>> {
  return transaction(async (client) => {
    if (!(await clientOwnsDeck(client, deckId, ownerToken))) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    const rows = await client.query<PitchBackupRow>(
      `select id, version, reason, document, title, metadata, created_at
        from pitch_deck_backups
        where deck_id = $1
        order by created_at desc, id desc
        limit $2`,
      [deckId, PITCH_BACKUP_KEEP_COUNT + PITCH_PUBLISHED_BACKUP_KEEP_COUNT],
    );
    return { ok: true, value: rows.rows.map(toPitchVersionHistoryItem) };
  });
}

export async function readPitchBackupForOwner(
  deckId: string,
  ownerToken: string,
  backupId: string,
): Promise<PitchStoreResult<PitchVersionPreview>> {
  return transaction(async (client) => {
    if (!(await clientOwnsDeck(client, deckId, ownerToken))) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    const backup = await client.query<PitchBackupRow>(
      `select id, version, reason, document, title, metadata, created_at
         from pitch_deck_backups
        where id = $1 and deck_id = $2`,
      [backupId, deckId],
    );
    const row = backup.rows[0];
    if (!row) return { ok: false, status: 404, error: "Pitch version not found" };
    return {
      ok: true,
      value: { item: toPitchVersionHistoryItem(row), document: parseStoredDocument(row.document) },
    };
  });
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
    if (!current || !["active", "archived"].includes(current.lifecycle)) return null;
    const ownerChanged = current.owner_email_hash !== hashPitchValue(email);
    const rows = await client.query<PitchDeckRow>(
      `update pitch_decks
        set title = $2,
            owner_name = $3,
            owner_email = $4,
            owner_email_hash = $5,
            updated_at = now()
        where id = $1 and lifecycle in ('active', 'archived')
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
    if (!row || !["active", "archived"].includes(row.lifecycle)) return null;
    return restorePitchBackup(client, row, backupId, "admin");
  });
}

export async function restorePitchBackupForOwner(
  deckId: string,
  ownerToken: string,
  backupId: string,
): Promise<PitchStoreResult<StoredPitchDeck>> {
  return transaction(async (client) => {
    if (!(await clientOwnsDeck(client, deckId, ownerToken))) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    const row = await clientDeck(client, deckId, true);
    if (!row || row.lifecycle !== "active") {
      return { ok: false, status: 409, error: "This pitch can no longer be edited" };
    }
    const restored = await restorePitchBackup(client, row, backupId, "owner");
    return restored
      ? { ok: true, value: restored }
      : { ok: false, status: 404, error: "Pitch version not found" };
  });
}

export async function markPitchDeckDeletingForAdmin(
  deckId: string,
  confirmation: string,
): Promise<PitchStoreResult<StoredPitchDeck>> {
  return transaction(async (client) => {
    const current = await clientDeck(client, deckId, true);
    if (!current || !["active", "archived"].includes(current.lifecycle)) {
      return { ok: false, status: 404, error: "Pitch not found" };
    }
    if (confirmation !== current.title) {
      return { ok: false, status: 400, error: "Type the exact pitch title" };
    }
    const rows = await client.query<PitchDeckRow>(
      `update pitch_decks
        set lifecycle = 'trashed',
            trashed_at = now(),
            purge_after = now() + ($2 * interval '1 day'),
            updated_at = now()
        where id = $1
        returning *`,
      [deckId, PITCH_TRASH_RETENTION_DAYS],
    );
    await insertAudit(client, {
      deckId,
      action: "deck.trashed",
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
        where id = $1 and lifecycle in ('active', 'archived')
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

export async function restorePitchDeckFromTrash(deckId: string): Promise<StoredPitchDeck | null> {
  return transaction(async (client) => {
    const rows = await client.query<PitchDeckRow>(
      `update pitch_decks
          set lifecycle = 'active', trashed_at = null, purge_after = null, updated_at = now()
        where id = $1 and lifecycle = 'trashed'
        returning *`,
      [deckId],
    );
    if (!rows.rows[0]) return null;
    await insertAudit(client, {
      deckId,
      action: "deck.trash.restored",
      actor: "admin",
    });
    return toStoredDeck(rows.rows[0]);
  });
}

export async function markExpiredPitchDecksDeleting(limit = 100): Promise<StoredPitchDeck[]> {
  return transaction(async (client) => {
    await client.query(
      `update pitch_decks
          set lifecycle = 'trashed',
              trashed_at = now(),
              purge_after = now() + ($2 * interval '1 day'),
              updated_at = now()
        where id in (
          select id from pitch_decks
           where lifecycle = 'active'
             and published_at is null
             and draft_expires_at <= now()
           order by draft_expires_at, id
           for update skip locked
           limit $1
        )`,
      [Math.min(500, Math.max(1, limit)), PITCH_TRASH_RETENTION_DAYS],
    );
    const rows = await client.query<PitchDeckRow>(
      `with candidates as (
         select id from pitch_decks
          where lifecycle = 'trashed' and purge_after <= now()
          order by purge_after, id
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

export async function prunePitchCommands(limit = 1_000): Promise<number> {
  const rows = await query<{ command_id: string }>(
    `with expired as (
       select deck_id, command_id
         from pitch_commands
        where created_at < now() - ($1 * interval '1 day')
        order by created_at, deck_id, command_id
        limit $2
     )
     delete from pitch_commands command
      using expired
      where command.deck_id = expired.deck_id
        and command.command_id = expired.command_id
      returning command.command_id`,
    [PITCH_COMMAND_RETENTION_DAYS, Math.min(5_000, Math.max(1, limit))],
  );
  return rows.length;
}
