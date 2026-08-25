import { randomBytes } from "node:crypto";

import { log } from "@/lib/platform/logger.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import {
  MAX_EXPIRY_SECONDS,
  createTransfer,
  generateDeleteToken,
  generateTransferId,
  getTransfer,
} from "@/features/transfers/store.server";
import { isValidEventSlug, type EventAlbumView } from "./types";
import { getEvent } from "./store.server";
import { isCapabilityEffective } from "@/features/attendee-operations/capabilities.server";

type EventDropResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/**
 * Event guest drops.
 *
 * "Everyone at the party can add their photos and videos." The admin turns
 * it on with an expiry, gets a bearer link and QR to share, and the media
 * lands in a normal transfer — previews, video processing, download, and
 * expiry cleanup all come from the machinery that already exists.
 *
 * The transfer's own TTL is the source of truth for lifetime; the row here
 * scopes the token to the event and gives the admin a kill switch.
 */

const DROP_TOKEN_PATTERN = /^drp_[A-Za-z0-9_-]{26,64}$/;

export function isValidDropToken(value: unknown): value is string {
  return typeof value === "string" && DROP_TOKEN_PATTERN.test(value);
}

export function dropPath(token: string): string {
  return `/drop/${token}`;
}

type EventDropRow = {
  event_slug: string;
  token: string;
  transfer_id: string;
  created_at: Date;
  expires_at: Date;
  disabled_at: Date | null;
};

export type EventDropRecord = {
  eventSlug: string;
  token: string;
  transferId: string;
  createdAt: string;
  expiresAt: string;
  disabledAt?: string;
};

function toDrop(row: EventDropRow): EventDropRecord {
  return {
    eventSlug: row.event_slug,
    token: row.token,
    transferId: row.transfer_id,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    disabledAt: row.disabled_at?.toISOString(),
  };
}

export type EventDropStatus = EventDropRecord & {
  /** Live means guests can upload right now. */
  live: boolean;
  fileCount: number;
};

export async function getEventDrop(eventSlug: string): Promise<EventDropStatus | null> {
  if (!isValidEventSlug(eventSlug)) return null;
  const row = await queryOne<EventDropRow>(`select * from event_drops where event_slug = $1`, [
    eventSlug,
  ]);
  if (!row) return null;

  const record = toDrop(row);
  const transfer = await getTransfer(record.transferId);
  return {
    ...record,
    live: !record.disabledAt && transfer !== null && Date.parse(record.expiresAt) > Date.now(),
    fileCount: transfer?.files.length ?? 0,
  };
}

/**
 * The album as a ticket holder sees it.
 *
 * Deliberately hands back no drop token when uploads are closed: the token is
 * the write capability, and a holder reading old photos has no use for it.
 */
export async function getEventAlbumView(eventSlug: string): Promise<EventAlbumView> {
  if (!isValidEventSlug(eventSlug)) return { state: "pending", fileCount: 0 };
  if (!(await isCapabilityEffective(eventSlug, "guestPhotos"))) {
    return { state: "closed", fileCount: 0 };
  }

  const row = await queryOne<EventDropRow>(`select * from event_drops where event_slug = $1`, [
    eventSlug,
  ]);
  if (!row) return { state: "pending", fileCount: 0 };

  const record = toDrop(row);
  const transfer = await getTransfer(record.transferId);
  // The transfer's own TTL is the real lifetime; once it lapses there is
  // nothing left to link to.
  if (!transfer) return { state: "closed", fileCount: 0 };

  const live = !record.disabledAt && Date.parse(record.expiresAt) > Date.now();

  return {
    state: live ? "open" : "closed",
    albumPath: `/t/${record.transferId}`,
    uploadPath: live ? dropPath(record.token) : undefined,
    fileCount: transfer.files.length,
    expiresAt: record.expiresAt,
  };
}

/**
 * Turn uploads on for an event.
 *
 * Re-enabling reuses the existing album while its transfer is alive, so
 * toggling off and on does not orphan what guests already sent.
 */
export async function enableEventDrop(
  eventSlug: string,
  expirySeconds: number,
): Promise<EventDropResult<EventDropStatus>> {
  const event = await getEvent(eventSlug);
  if (!event) return { ok: false, status: 404, error: "Event not found" };

  const ttlSeconds = Math.floor(expirySeconds);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 60 * 60 || ttlSeconds > MAX_EXPIRY_SECONDS) {
    return { ok: false, status: 400, error: "Pick an expiry between 1 hour and 30 days" };
  }

  const existing = await getEventDrop(eventSlug);
  if (existing && (await getTransfer(existing.transferId))) {
    const row = await queryOne<EventDropRow>(
      `update event_drops set disabled_at = null where event_slug = $1 returning *`,
      [eventSlug],
    );
    if (row) {
      const revived = await getEventDrop(eventSlug);
      if (revived) return { ok: true, value: revived };
    }
  }

  const transferId = generateTransferId();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const created = await createTransfer(
    {
      id: transferId,
      title: `${event.title} — guest album`,
      files: [],
      createdAt: new Date().toISOString(),
      expiresAt,
      deleteToken: generateDeleteToken(),
    },
    ttlSeconds,
  );
  if (!created) return { ok: false, status: 500, error: "Failed to create the album" };

  const token = `drp_${randomBytes(20).toString("base64url")}`;
  const row = await queryOne<EventDropRow>(
    `insert into event_drops (event_slug, token, transfer_id, expires_at)
     values ($1, $2, $3, $4)
     on conflict (event_slug) do update
       set token = excluded.token,
           transfer_id = excluded.transfer_id,
           expires_at = excluded.expires_at,
           created_at = now(),
           disabled_at = null
     returning *`,
    [eventSlug, token, transferId, expiresAt],
  );
  if (!row) return { ok: false, status: 500, error: "Failed to save the drop" };

  log.info("event-drop.enable", "Guest uploads enabled", { slug: eventSlug, ttlSeconds });
  const status = await getEventDrop(eventSlug);
  if (!status) return { ok: false, status: 500, error: "Failed to load the drop" };
  return { ok: true, value: status };
}

/** The kill switch: uploads stop; media already sent stays until expiry. */
export async function disableEventDrop(eventSlug: string): Promise<EventDropResult<void>> {
  if (!isValidEventSlug(eventSlug)) return { ok: false, status: 404, error: "Event not found" };
  await query(`update event_drops set disabled_at = now() where event_slug = $1`, [eventSlug]);
  log.info("event-drop.disable", "Guest uploads disabled", { slug: eventSlug });
  return { ok: true, value: undefined };
}

export type ResolvedDrop = {
  eventSlug: string;
  eventTitle: string;
  transferId: string;
  expiresAt: string;
  fileCount: number;
};

/** A presented token resolves only while the drop is live. */
export async function resolveDropToken(token: string): Promise<ResolvedDrop | null> {
  if (!isValidDropToken(token)) return null;
  const row = await queryOne<EventDropRow>(
    `select * from event_drops
      where token = $1 and disabled_at is null and expires_at > now()`,
    [token],
  );
  if (!row) return null;
  if (!(await isCapabilityEffective(row.event_slug, "guestPhotos"))) return null;

  const [event, transfer] = await Promise.all([
    getEvent(row.event_slug),
    getTransfer(row.transfer_id),
  ]);
  if (!event || !transfer) return null;

  return {
    eventSlug: row.event_slug,
    eventTitle: event.title,
    transferId: row.transfer_id,
    expiresAt: row.expires_at.toISOString(),
    fileCount: transfer.files.length,
  };
}
