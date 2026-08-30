import { randomBytes } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";

import { getEvent } from "@/features/events/store.server";
import {
  isValidScannerToken,
  type CheckpointRecord,
  type CheckpointScanOutcome,
  type GuestRequestRecord,
  type ScannerLinkRecord,
  type ScannerPermissionSet,
  type ScannerRole,
} from "./checkpoint-types";
import {
  cancelGuestRequest,
  createGuestRequest,
  decideGuestRequest,
  listGuestRequests,
  listGuestRequestsForToken,
} from "./guest-requests.server";
import { issueTickets } from "./tickets.server";
import {
  checkpointScan,
  getCheckpoint,
  getCheckpointSummaries,
  listCheckpointUsage,
  undoCheckpointUse,
} from "./checkpoints.server";
import { checkpointAllowanceFor } from "./checkpoint-types";
import { recordScannerDevice, resolveScannerLink } from "./scanner-links.server";
import { listTicketsForEvent } from "./store.server";
import { getDoorDataFn } from "./tickets.functions";
import type { DoorDataResult } from "./tickets.functions";
import { ticketPublicId } from "./types";

/**
 * Server functions for the shared-link scanner page.
 *
 * The token in the URL is the whole credential: every function here
 * re-resolves it server-side, so a revoked link stops working on the very
 * next scan, not at the next page load.
 */

/** One row of the checkpoint scanner's search list. */
export type CheckpointDirectoryTicket = {
  id: string;
  holderName: string;
  ticketTypeName: string;
  allowance: number;
  used: number;
};

export type ScannerPageResult =
  | { found: false }
  | {
      found: true;
      mode: "door";
      label: string;
      token: string;
      eventSlug: string;
      eventTitle: string;
      role: ScannerRole;
      permissions: ScannerPermissionSet;
      /** Own requests, or every pending one when this link approves. */
      requests: GuestRequestRecord[];
      door: Extract<DoorDataResult, { authorised: true }>;
    }
  | {
      found: true;
      mode: "checkpoint";
      label: string;
      token: string;
      eventSlug: string;
      eventTitle: string;
      checkpoint: CheckpointRecord;
      summary: { unitsUsed: number; ticketsServed: number };
      /**
       * Valid tickets for typeahead — same trust level as the door list a
       * door link already carries. Emails and payment data never leave the
       * server.
       */
      tickets: CheckpointDirectoryTicket[];
    };

async function resolveLiveLink(token: string): Promise<ScannerLinkRecord | null> {
  if (!isValidScannerToken(token)) return null;
  return resolveScannerLink(token);
}

const DEVICE_COOKIE = "mah-scanner-device";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * A stable anonymous id per browser, so the admin can see how many phones
 * are actually working each link. Identifies the device to us only — it
 * carries no personal data and grants nothing by itself.
 */
function ensureDeviceId(): string {
  const existing = getCookie(DEVICE_COOKIE);
  if (existing && DEVICE_ID_PATTERN.test(existing)) return existing;
  const id = randomBytes(12).toString("base64url");
  setCookie(DEVICE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
  return id;
}

export const getScannerPageFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }): Promise<ScannerPageResult> => {
    const link = await resolveLiveLink(data.token);
    if (!link) return { found: false };

    const event = await getEvent(link.eventSlug);
    if (!event) return { found: false };

    // Best-effort: device visibility must never block scanning.
    try {
      await recordScannerDevice(link.token, ensureDeviceId());
    } catch {
      // The link still works; the admin just sees one fewer device.
    }

    if (link.checkpointId === null) {
      const [door, requests] = await Promise.all([
        getDoorDataFn({ data: { eventSlug: link.eventSlug, scannerToken: link.token } }),
        link.permissions.approveRequests
          ? listGuestRequests(link.eventSlug, "pending")
          : listGuestRequestsForToken(link.token),
      ]);
      if (!door.authorised) return { found: false };
      return {
        found: true,
        mode: "door",
        label: link.label,
        token: link.token,
        eventSlug: link.eventSlug,
        eventTitle: event.title,
        role: link.role,
        permissions: link.permissions,
        requests,
        door,
      };
    }

    const checkpoint = await getCheckpoint(link.eventSlug, link.checkpointId);
    if (!checkpoint) return { found: false };
    const [summaries, usage, eventTickets] = await Promise.all([
      getCheckpointSummaries(link.eventSlug),
      listCheckpointUsage(link.eventSlug, checkpoint.id),
      listTicketsForEvent(link.eventSlug),
    ]);
    const summary = summaries.find((entry) => entry.checkpointId === checkpoint.id);

    const typeNames = new Map(event.ticketTypes.map((type) => [type.id, type.name]));
    const tickets: CheckpointDirectoryTicket[] = eventTickets
      .filter((ticket) => ticket.status === "valid")
      .map((ticket) => ({
        id: ticketPublicId(ticket),
        holderName: ticket.holderName,
        ticketTypeName: typeNames.get(ticket.ticketTypeId) ?? "Ticket",
        allowance: checkpointAllowanceFor(checkpoint, ticket.ticketTypeId),
        used: usage[ticket.id] ?? 0,
      }));

    return {
      found: true,
      mode: "checkpoint",
      label: link.label,
      token: link.token,
      eventSlug: link.eventSlug,
      eventTitle: event.title,
      checkpoint,
      summary: {
        unitsUsed: summary?.unitsUsed ?? 0,
        ticketsServed: summary?.ticketsServed ?? 0,
      },
      tickets,
    };
  });

/**
 * Authorise a checkpoint action with a live link for that exact station.
 */
async function authoriseCheckpoint(
  token: string | undefined,
  eventSlug: string,
  checkpointId: string,
): Promise<{ ok: true; scannedBy: string } | { ok: false }> {
  if (token) {
    const link = await resolveLiveLink(token);
    if (link && link.eventSlug === eventSlug && link.checkpointId === checkpointId) {
      return { ok: true, scannedBy: link.label };
    }
  }
  return { ok: false };
}

export type CheckpointScanResult =
  | { authorised: false }
  | { authorised: true; outcome: CheckpointScanOutcome };

export const checkpointScanFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token?: string;
      eventSlug: string;
      checkpointId: string;
      scanned: string;
      consume?: number;
    }) => data,
  )
  .handler(async ({ data }): Promise<CheckpointScanResult> => {
    const auth = await authoriseCheckpoint(data.token, data.eventSlug, data.checkpointId);
    if (!auth.ok) return { authorised: false };

    const outcome = await checkpointScan({
      scanned: data.scanned,
      eventSlug: data.eventSlug,
      checkpointId: data.checkpointId,
      consume: data.consume,
      scannedBy: auth.scannedBy,
    });
    return { authorised: true, outcome };
  });

export type GuestSubmitResult =
  | { authorised: false }
  | { authorised: true; ok: false; error: string }
  | { authorised: true; ok: true; mode: "added"; holderName: string }
  | { authorised: true; ok: true; mode: "requested"; request: GuestRequestRecord };

/**
 * A scanner's "(+) add someone".
 *
 * A manager link adds the guest on the spot (comp, first visible ticket
 * type). A plain scanner raises a request that waits for the organiser or a
 * manager to decide.
 */
export const guestSubmitFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; name: string; note?: string }) => data)
  .handler(async ({ data }): Promise<GuestSubmitResult> => {
    const link = await resolveLiveLink(data.token);
    if (!link) return { authorised: false };

    const name = data.name?.trim();
    if (!name) return { authorised: true, ok: false, error: "Who should be added?" };

    if (link.permissions.addGuests) {
      const event = await getEvent(link.eventSlug);
      const ticketTypeId =
        event?.ticketTypes.find((type) => !type.hidden)?.id ?? event?.ticketTypes[0]?.id;
      if (!ticketTypeId) {
        return { authorised: true, ok: false, error: "No ticket type to issue against" };
      }
      const issued = await issueTickets({
        eventSlug: link.eventSlug,
        ticketTypeId,
        holderName: name,
        quantity: 1,
        kind: "comp",
        notes: `added at the door by ${link.label}`,
        bypassSalesWindow: true,
        bypassCapacity: true,
      });
      if (!issued.ok) return { authorised: true, ok: false, error: issued.error };
      return { authorised: true, ok: true, mode: "added", holderName: name };
    }

    if (!link.permissions.requestGuests) {
      return {
        authorised: true,
        ok: false,
        error: "This link can't add guests — ask the organiser.",
      };
    }

    const created = await createGuestRequest({
      eventSlug: link.eventSlug,
      token: link.token,
      requestedBy: link.label,
      name,
      note: data.note,
    });
    if (!created.ok) return { authorised: true, ok: false, error: created.error };
    return { authorised: true, ok: true, mode: "requested", request: created.value };
  });

export type GuestRequestsResult =
  | { authorised: false }
  | { authorised: true; role: ScannerRole; requests: GuestRequestRecord[] };

/** Refresh the requests view: own, or all pending when this link approves. */
export const guestRequestsFn = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }): Promise<GuestRequestsResult> => {
    const link = await resolveLiveLink(data.token);
    if (!link) return { authorised: false };
    const requests = link.permissions.approveRequests
      ? await listGuestRequests(link.eventSlug, "pending")
      : await listGuestRequestsForToken(link.token);
    return { authorised: true, role: link.role, requests };
  });

export type GuestActionResult =
  | { authorised: false }
  | { authorised: true; ok: true }
  | { authorised: true; ok: false; error: string };

export const guestRequestCancelFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: number }) => data)
  .handler(async ({ data }): Promise<GuestActionResult> => {
    const link = await resolveLiveLink(data.token);
    if (!link) return { authorised: false };
    const result = await cancelGuestRequest(data.id, link.token);
    if (!result.ok) return { authorised: true, ok: false, error: result.error };
    return { authorised: true, ok: true };
  });

/** Links with the approve ability decide from their phone; admin has its own route. */
export const guestRequestDecideFn = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: number; approve: boolean }) => data)
  .handler(async ({ data }): Promise<GuestActionResult> => {
    const link = await resolveLiveLink(data.token);
    if (!link || !link.permissions.approveRequests) return { authorised: false };
    const result = await decideGuestRequest({
      eventSlug: link.eventSlug,
      id: data.id,
      approve: data.approve,
      decidedBy: link.label,
    });
    if (!result.ok) return { authorised: true, ok: false, error: result.error };
    return { authorised: true, ok: true };
  });

export type CheckpointUndoResult =
  | { authorised: false }
  | { authorised: true; ok: true; used: number }
  | { authorised: true; ok: false; error: string };

export const checkpointUndoFn = createServerFn({ method: "POST" })
  .validator(
    (data: { token?: string; eventSlug: string; checkpointId: string; ticketId: string }) => data,
  )
  .handler(async ({ data }): Promise<CheckpointUndoResult> => {
    const auth = await authoriseCheckpoint(data.token, data.eventSlug, data.checkpointId);
    if (!auth.ok) return { authorised: false };

    const result = await undoCheckpointUse({
      eventSlug: data.eventSlug,
      checkpointId: data.checkpointId,
      ticketId: data.ticketId,
    });
    if (!result.ok) return { authorised: true, ok: false, error: result.error };
    return { authorised: true, ok: true, used: result.value.used };
  });
