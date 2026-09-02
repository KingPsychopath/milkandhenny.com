import { randomBytes } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";

import {
  admitStaffTicket,
  decideStaffGuestRequest,
  moveStaffTeamParticipant,
  scanStaffCheckpoint,
  setStaffGuestPhotos,
  shuffleStaffTeams,
  submitStaffGuest,
} from "@/features/event-scoring/staff-scoring.server";
import { getStaffOperationsPage } from "./staff-operations.server";
export type { StaffOperationsPageData } from "./staff-operations.server";

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

export const getStaffOperationsPageFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string; token: string }) => data)
  .handler(({ data }) => getStaffOperationsPage({ ...data, deviceId: ensureDeviceId() }));

export const admitStaffTicketFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; scanned: string }) => data)
  .handler(({ data }) => admitStaffTicket({ ...data, deviceId: ensureDeviceId() }));

export const scanStaffCheckpointFn = createServerFn({ method: "POST" })
  .validator(
    (data: { eventSlug: string; token: string; checkpointId: string; scanned: string }) => data,
  )
  .handler(({ data }) => scanStaffCheckpoint({ ...data, deviceId: ensureDeviceId() }));

export const shuffleStaffTeamsFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; teamCount: number }) => data)
  .handler(({ data }) => shuffleStaffTeams({ ...data, deviceId: ensureDeviceId() }));

export const moveStaffTeamParticipantFn = createServerFn({ method: "POST" })
  .validator(
    (data: { eventSlug: string; token: string; participantId: string; teamId: string }) => data,
  )
  .handler(({ data }) => moveStaffTeamParticipant({ ...data, deviceId: ensureDeviceId() }));

export const submitStaffGuestFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; name: string; note?: string }) => data)
  .handler(({ data }) => submitStaffGuest({ ...data, deviceId: ensureDeviceId() }));

export const decideStaffGuestRequestFn = createServerFn({ method: "POST" })
  .validator(
    (data: { eventSlug: string; token: string; requestId: number; approve: boolean }) => data,
  )
  .handler(({ data }) => decideStaffGuestRequest({ ...data, deviceId: ensureDeviceId() }));

export const setStaffGuestPhotosFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      token: string;
      enabled: boolean;
      expirySeconds?: number;
      opensAt?: string;
    }) => data,
  )
  .handler(({ data }) => setStaffGuestPhotos({ ...data, deviceId: ensureDeviceId() }));
