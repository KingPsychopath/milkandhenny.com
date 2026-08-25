import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { queryOne, transaction } from "@/lib/platform/postgres.server";
import { normaliseEmail } from "@/features/tickets/types";

export type ActionLinkPurpose =
  | "ticket-assignment"
  | "ticket-transfer"
  | "ticket-return"
  | "refund-consent"
  | "staff-invitation"
  | "admin-invitation";

export type ActionLinkRecord = {
  id: string;
  purpose: ActionLinkPurpose;
  intendedEmailHash: string;
  intendedEmailHint: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  expiresAt: string;
};

type ActionLinkRow = {
  id: string;
  purpose: ActionLinkPurpose;
  intended_email_hash: string;
  intended_email_hint: string;
  entity_type: string;
  entity_id: string;
  payload: unknown;
  expires_at: Date;
};

function id(): string {
  return `action_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export function actionTokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function actionEmailHash(value: string): string {
  return createHash("sha256").update(normaliseEmail(value)).digest("hex");
}

export function maskActionEmail(value: string): string {
  const [local = "", domain = ""] = normaliseEmail(value).split("@");
  return `${local.slice(0, 1)}${local.length > 1 ? "•••" : ""}@${domain}`;
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toRecord(row: ActionLinkRow): ActionLinkRecord {
  return {
    id: row.id,
    purpose: row.purpose,
    intendedEmailHash: row.intended_email_hash,
    intendedEmailHint: row.intended_email_hint,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: recordObject(row.payload),
    expiresAt: row.expires_at.toISOString(),
  };
}

export async function issueActionLink(
  client: PoolClient,
  input: {
    purpose: ActionLinkPurpose;
    intendedEmail: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
    issuedByType: "root-owner" | "admin" | "staff" | "attendee" | "system";
    issuedById?: string;
    expiresAt: Date;
  },
): Promise<{ id: string; token: string; record: ActionLinkRecord }> {
  const token = `mah_${randomBytes(32).toString("base64url")}`;
  const linkId = id();
  const result = await client.query<ActionLinkRow>(
    `insert into attendee_action_links
       (id,token_hash,purpose,intended_email_hash,intended_email_hint,entity_type,entity_id,
        payload,issued_by_type,issued_by_id,expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)
     returning id,purpose,intended_email_hash,intended_email_hint,entity_type,entity_id,payload,expires_at`,
    [
      linkId,
      actionTokenHash(token),
      input.purpose,
      actionEmailHash(input.intendedEmail),
      maskActionEmail(input.intendedEmail),
      input.entityType,
      input.entityId,
      JSON.stringify(input.payload ?? {}),
      input.issuedByType,
      input.issuedById ?? null,
      input.expiresAt,
    ],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Action link could not be created");
  return { id: linkId, token, record: toRecord(row) };
}

export async function inspectActionLink(token: string): Promise<ActionLinkRecord | null> {
  const row = await queryOne<ActionLinkRow>(
    `select id,purpose,intended_email_hash,intended_email_hint,entity_type,entity_id,payload,expires_at
       from attendee_action_links
      where token_hash = $1 and consumed_at is null and revoked_at is null and expires_at > now()`,
    [actionTokenHash(token)],
  );
  return row ? toRecord(row) : null;
}

export async function consumeActionLink<T>(
  token: string,
  use: (client: PoolClient, link: ActionLinkRecord) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; status: number; error: string }> {
  return transaction(async (client) => {
    const selected = await client.query<ActionLinkRow>(
      `select id,purpose,intended_email_hash,intended_email_hint,entity_type,entity_id,payload,expires_at
         from attendee_action_links where token_hash = $1 for update`,
      [actionTokenHash(token)],
    );
    const row = selected.rows[0];
    if (!row) return { ok: false, status: 404, error: "This action link is not recognised" };
    const state = await client.query<{
      consumed_at: Date | null;
      revoked_at: Date | null;
      expires_at: Date;
    }>(`select consumed_at,revoked_at,expires_at from attendee_action_links where id = $1`, [
      row.id,
    ]);
    const current = state.rows[0];
    if (!current || current.revoked_at)
      return { ok: false, status: 410, error: "This action was cancelled or replaced" };
    if (current.consumed_at)
      return { ok: false, status: 409, error: "This action link has already been used" };
    if (current.expires_at <= new Date())
      return { ok: false, status: 410, error: "This action link has expired" };
    const value = await use(client, toRecord(row));
    await client.query(`update attendee_action_links set consumed_at = now() where id = $1`, [
      row.id,
    ]);
    return { ok: true, value };
  });
}

export async function revokeActionLink(
  client: PoolClient,
  linkId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `update attendee_action_links
        set revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, $2)
      where id = $1 and consumed_at is null`,
    [linkId, reason],
  );
}
