import { randomBytes } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";

import {
  awardStaffPoints,
  admitStaffTicket,
  getStaffScoringPage,
  reverseStaffAward,
  resolveStaffScannedParticipant,
  searchStaffParticipants,
} from "./staff-scoring.server";

const DEVICE_COOKIE = "mah-score-staff-device";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function ensureDeviceId(): string {
  const current = getCookie(DEVICE_COOKIE);
  if (current && DEVICE_ID_PATTERN.test(current)) return current;
  const deviceId = randomBytes(12).toString("base64url");
  setCookie(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60,
  });
  return deviceId;
}

export const getStaffScoringPageFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string; token: string }) => data)
  .handler(({ data }) => getStaffScoringPage({ ...data, deviceId: ensureDeviceId() }));

export const searchStaffParticipantsFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string; token: string; term: string }) => data)
  .handler(({ data }) => searchStaffParticipants({ ...data, deviceId: ensureDeviceId() }));

export const resolveStaffScannedParticipantFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; scanned: string }) => data)
  .handler(({ data }) => resolveStaffScannedParticipant({ ...data, deviceId: ensureDeviceId() }));

export const awardStaffPointsFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      token: string;
      activityId: string;
      participantId?: string;
      scanned?: string;
      placement?: number;
      rawScore?: number;
      points?: number;
      commandId: string;
      note?: string;
      confirmLarge?: boolean;
    }) => data,
  )
  .handler(async ({ data }) => {
    const deviceId = ensureDeviceId();
    const result = await awardStaffPoints({ ...data, deviceId });
    const page = result.ok
      ? await getStaffScoringPage({ eventSlug: data.eventSlug, token: data.token, deviceId })
      : null;
    const pool = page?.found
      ? (page.pools.find((entry) => entry.activityId === data.activityId) ?? page.pools[0])
      : undefined;
    return result.ok
      ? {
          ok: true as const,
          value: {
            id: result.value.id,
            points: result.value.postings.reduce((sum, posting) => sum + posting.points, 0),
            remainingPool: pool?.available,
          },
        }
      : result;
  });

export const admitStaffTicketFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; scanned: string }) => data)
  .handler(({ data }) => admitStaffTicket({ ...data, deviceId: ensureDeviceId() }));

export const reverseStaffAwardFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      token: string;
      transactionId: string;
      commandId: string;
      note: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const result = await reverseStaffAward({ ...data, deviceId: ensureDeviceId() });
    return result.ok ? { ok: true as const, value: { id: result.value.id } } : result;
  });
