import { createServerFn } from "@tanstack/react-start";

import { ensureServerDeviceId } from "@/lib/platform/device-cookie.server";

import {
  admitStaffTicket,
  decideStaffGuestRequest,
  moveStaffTeamParticipant,
  scanStaffCheckpoint,
  setStaffGuestPhotos,
  shuffleStaffTeams,
  submitStaffGuest,
} from "@/features/event-scoring/staff-scoring.server";
import { emailStaffTeams, getStaffOperationsPage } from "./staff-operations.server";
export type { StaffOperationsPageData } from "./staff-operations.server";

const DEVICE_COOKIE = "mah-score-staff-device";

function ensureDeviceId(): string {
  return ensureServerDeviceId(DEVICE_COOKIE);
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

export const emailStaffTeamsFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string }) => data)
  .handler(({ data }) => emailStaffTeams({ ...data, deviceId: ensureDeviceId() }));

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
