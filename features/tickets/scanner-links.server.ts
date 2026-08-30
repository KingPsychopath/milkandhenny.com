import { randomBytes } from "node:crypto";

import { log } from "@/lib/platform/logger.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import { isValidEventSlug } from "@/features/events/types";
import { getEvent } from "@/features/events/store.server";
import {
  SCANNER_PERMISSIONS,
  effectiveScannerPermissions,
  isScannerRole,
  isValidCheckpointId,
  isValidScannerToken,
  type ScannerLinkRecord,
  type ScannerPermission,
  type ScannerRole,
} from "./checkpoint-types";
import { getCheckpoint } from "./checkpoints.server";
import type { TicketOpResult } from "./tickets.server";

/**
 * Scanner links.
 *
 * A link is how a non-technical person gets scanning access: the admin makes
 * one, sends it over WhatsApp, and the recipient opens it — no PIN, no
 * account. The token is the credential, scoped to one event and one station,
 * and revocable the moment the shift ends.
 *
 * Same bearer posture as ticket ids (stored plaintext, high entropy): the
 * admin must be able to re-copy a link mid-event when someone loses it.
 */

type ScannerLinkRow = {
  token: string;
  label: string;
  event_slug: string;
  checkpoint_id: string | null;
  role: string;
  permissions: unknown;
  created_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  last_used_at: Date | null;
};

function toLink(row: ScannerLinkRow): ScannerLinkRecord {
  const role: ScannerRole = isScannerRole(row.role) ? row.role : "scanner";
  const overrides =
    row.permissions && typeof row.permissions === "object" && !Array.isArray(row.permissions)
      ? (row.permissions as Partial<Record<ScannerPermission, unknown>>)
      : undefined;
  return {
    token: row.token,
    label: row.label,
    eventSlug: row.event_slug,
    checkpointId: row.checkpoint_id,
    role,
    permissions: effectiveScannerPermissions(role, overrides),
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at?.toISOString(),
    revokedAt: row.revoked_at?.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString(),
  };
}

function generateScannerToken(): string {
  return `scn_${randomBytes(20).toString("base64url")}`;
}

export type CreateScannerLinkInput = {
  eventSlug: string;
  /** null gives the link the door; otherwise a checkpoint on the event. */
  checkpointId: string | null;
  label: string;
  role?: ScannerRole;
  expiresAt?: string;
};

export async function createScannerLink(
  input: CreateScannerLinkInput,
): Promise<TicketOpResult<ScannerLinkRecord>> {
  const label = input.label?.trim();
  if (!label) return { ok: false, status: 400, error: "Name the person or station" };
  if (label.length > 60) return { ok: false, status: 400, error: "That label is too long" };
  if (!isValidEventSlug(input.eventSlug)) {
    return { ok: false, status: 404, error: "Event not found" };
  }
  if (!(await getEvent(input.eventSlug))) {
    return { ok: false, status: 404, error: "Event not found" };
  }

  if (input.checkpointId !== null) {
    if (!isValidCheckpointId(input.checkpointId)) {
      return { ok: false, status: 400, error: "Unknown checkpoint" };
    }
    const checkpoint = await getCheckpoint(input.eventSlug, input.checkpointId);
    if (!checkpoint) return { ok: false, status: 404, error: "Checkpoint not found" };
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const parsed = new Date(input.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return { ok: false, status: 400, error: "That expiry doesn't look like a date" };
    }
    if (parsed.getTime() <= Date.now()) {
      return { ok: false, status: 400, error: "Choose an expiry in the future" };
    }
    expiresAt = parsed;
  }

  const role: ScannerRole = isScannerRole(input.role) ? input.role : "scanner";
  const row = await queryOne<ScannerLinkRow>(
    `insert into scanner_links (token, label, event_slug, checkpoint_id, role, expires_at)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [generateScannerToken(), label, input.eventSlug, input.checkpointId, role, expiresAt],
  );
  if (!row) return { ok: false, status: 500, error: "Failed to create the link" };

  log.info("scanner-links.create", "Scanner link created", {
    slug: input.eventSlug,
    checkpointId: input.checkpointId,
    label,
  });
  return { ok: true, value: toLink(row) };
}

export async function listScannerLinks(eventSlug: string): Promise<ScannerLinkRecord[]> {
  if (!isValidEventSlug(eventSlug)) return [];
  const rows = await query<ScannerLinkRow>(
    `select * from scanner_links where event_slug = $1 order by created_at desc`,
    [eventSlug],
  );
  return rows.map(toLink);
}

export type ScannerLinkDevices = { count: number; lastSeen?: string };

/** Devices that have opened each of an event's links, keyed by token. */
export async function listScannerLinkDevices(
  eventSlug: string,
): Promise<Record<string, ScannerLinkDevices>> {
  if (!isValidEventSlug(eventSlug)) return {};
  const rows = await query<{ token: string; devices: string; last_seen: Date | null }>(
    `select d.token, count(*)::text as devices, max(d.last_seen) as last_seen
       from scanner_link_devices d
       join scanner_links l on l.token = d.token
      where l.event_slug = $1
      group by d.token`,
    [eventSlug],
  );
  const devices: Record<string, ScannerLinkDevices> = {};
  for (const row of rows) {
    devices[row.token] = {
      count: Number.parseInt(row.devices, 10) || 0,
      lastSeen: row.last_seen?.toISOString(),
    };
  }
  return devices;
}

/** Record that `deviceId` opened `token`. Called on every scanner page load. */
export async function recordScannerDevice(token: string, deviceId: string): Promise<void> {
  if (!isValidScannerToken(token) || !/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) return;
  await query(
    `insert into scanner_link_devices (token, device_id)
     values ($1, $2)
     on conflict (token, device_id) do update set last_seen = now()`,
    [token, deviceId],
  );
}

/**
 * Change a link's level or ability overrides in place — the URL the helper
 * already holds keeps working with its new powers on their next action.
 */
export async function updateScannerLink(
  token: string,
  changes: { role?: ScannerRole; permissions?: Partial<Record<ScannerPermission, boolean>> },
): Promise<TicketOpResult<ScannerLinkRecord>> {
  if (!isValidScannerToken(token)) return { ok: false, status: 400, error: "Unknown link" };

  const overrides: Record<string, boolean> = {};
  for (const permission of SCANNER_PERMISSIONS) {
    const value = changes.permissions?.[permission];
    if (typeof value === "boolean") overrides[permission] = value;
  }

  const row = await queryOne<ScannerLinkRow>(
    `update scanner_links
        set role = coalesce($2, role),
            permissions = case when $3 then $4::jsonb else permissions end
      where token = $1
      returning *`,
    [
      token,
      changes.role && isScannerRole(changes.role) ? changes.role : null,
      changes.permissions !== undefined,
      JSON.stringify(overrides),
    ],
  );
  if (!row) return { ok: false, status: 404, error: "Unknown link" };
  log.info("scanner-links.update", "Scanner link updated", {});
  return { ok: true, value: toLink(row) };
}

export async function revokeScannerLink(token: string): Promise<TicketOpResult<void>> {
  if (!isValidScannerToken(token)) return { ok: false, status: 400, error: "Unknown link" };
  await query(`update scanner_links set revoked_at = now() where token = $1`, [token]);
  log.info("scanner-links.revoke", "Scanner link revoked", {});
  return { ok: true, value: undefined };
}

/** End-of-night kill switch: every live link for the event stops at once. */
export async function revokeAllScannerLinks(eventSlug: string): Promise<TicketOpResult<number>> {
  if (!isValidEventSlug(eventSlug)) return { ok: false, status: 404, error: "Event not found" };
  const rows = await query<{ token: string }>(
    `update scanner_links set revoked_at = now()
      where event_slug = $1 and revoked_at is null
      returning token`,
    [eventSlug],
  );
  log.info("scanner-links.revoke-all", "All scanner links revoked", {
    slug: eventSlug,
    count: rows.length,
  });
  return { ok: true, value: rows.length };
}

/**
 * Resolve a presented token to a live link.
 *
 * Returns null for anything that should not scan: unknown, revoked, or
 * expired. `last_used_at` is refreshed as a side effect so the admin can see
 * which links are actually being worked.
 */
export async function resolveScannerLink(token: string): Promise<ScannerLinkRecord | null> {
  if (!isValidScannerToken(token)) return null;
  const row = await queryOne<ScannerLinkRow>(
    `update scanner_links
        set last_used_at = now()
      where token = $1
        and revoked_at is null
        and (expires_at is null or expires_at > now())
      returning *`,
    [token],
  );
  return row ? toLink(row) : null;
}
