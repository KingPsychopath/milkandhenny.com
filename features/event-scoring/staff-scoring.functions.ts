import { randomBytes } from "node:crypto";

import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest, setCookie } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { runEventsEffect } from "@/features/events/events-runtime.server";
import { type OfflineScoreCommand } from "./offline.server";
import { EventScoringService } from "./event-scoring-service.server";

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

function runScoring<A, E>(
  use: (service: typeof EventScoringService.Service) => Effect.Effect<A, E>,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      return yield* use(yield* EventScoringService);
    }),
    getRequest().signal,
  );
}

export const getStaffScoringPageFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string; token: string }) => data)
  .handler(({ data }) =>
    runScoring((scoring) => scoring.getStaffPage({ ...data, deviceId: ensureDeviceId() })),
  );

export const searchStaffParticipantsFn = createServerFn({ method: "GET" })
  .validator((data: { eventSlug: string; token: string; term: string }) => data)
  .handler(({ data }) =>
    runScoring((scoring) =>
      scoring.searchStaffParticipants({ ...data, deviceId: ensureDeviceId() }),
    ),
  );

export const resolveStaffScannedParticipantFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; scanned: string }) => data)
  .handler(({ data }) =>
    runScoring((scoring) =>
      scoring.resolveStaffParticipant({ ...data, deviceId: ensureDeviceId() }),
    ),
  );

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
      recipientScope?: "participant" | "order";
      commandId: string;
      note?: string;
      confirmLarge?: boolean;
      media?: {
        storageRef: string;
        visibility: "event-album" | "admin-evidence" | "discard";
        consentState: "not-requested" | "requested" | "obtained" | "declined";
      };
    }) => data,
  )
  .handler(async ({ data }) => {
    const deviceId = ensureDeviceId();
    const { result, page } = await runScoring((scoring) =>
      Effect.gen(function* () {
        const result = yield* scoring.awardStaffPoints({ ...data, deviceId });
        const page = result.ok
          ? yield* scoring.getStaffPage({ eventSlug: data.eventSlug, token: data.token, deviceId })
          : null;
        return { result, page };
      }),
    );
    const pool = page?.found
      ? (page.pools.find((entry) => entry.activityId === data.activityId) ?? page.pools[0])
      : undefined;
    return result.ok
      ? {
          ok: true as const,
          value: {
            id: result.value.id,
            points: result.value.postings.reduce((sum, posting) => sum + posting.points, 0),
            recipients: result.value.postings.length,
            pointsEach: result.value.postings[0]?.points ?? 0,
            remainingPool: pool?.available,
          },
        }
      : result;
  });

export const mintStaffAwardClaimFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      token: string;
      activityId: string;
      points?: number;
      note?: string;
      expiresInSeconds?: number;
    }) => data,
  )
  .handler(({ data }) =>
    runScoring((scoring) => scoring.mintStaffAward({ ...data, deviceId: ensureDeviceId() })),
  );

export const admitStaffTicketFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; scanned: string }) => data)
  .handler(({ data }) =>
    runScoring((scoring) => scoring.admitStaffTicket({ ...data, deviceId: ensureDeviceId() })),
  );

export const scanStaffCheckpointFn = createServerFn({ method: "POST" })
  .validator(
    (data: { eventSlug: string; token: string; checkpointId: string; scanned: string }) => data,
  )
  .handler(({ data }) =>
    runScoring((scoring) => scoring.scanStaffCheckpoint({ ...data, deviceId: ensureDeviceId() })),
  );

export const shuffleStaffTeamsFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; teamCount: number }) => data)
  .handler(({ data }) =>
    runScoring((scoring) => scoring.shuffleStaffTeams({ ...data, deviceId: ensureDeviceId() })),
  );

export const moveStaffTeamParticipantFn = createServerFn({ method: "POST" })
  .validator(
    (data: { eventSlug: string; token: string; participantId: string; teamId: string }) => data,
  )
  .handler(({ data }) =>
    runScoring((scoring) =>
      scoring.moveStaffTeamParticipant({ ...data, deviceId: ensureDeviceId() }),
    ),
  );

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
    const result = await runScoring((scoring) =>
      scoring.reverseStaffAward({ ...data, deviceId: ensureDeviceId() }),
    );
    return result.ok ? { ok: true as const, value: { id: result.value.id } } : result;
  });

export const submitStaffGuestFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; name: string; note?: string }) => data)
  .handler(({ data }) =>
    runScoring((scoring) => scoring.submitStaffGuest({ ...data, deviceId: ensureDeviceId() })),
  );

export const decideStaffGuestRequestFn = createServerFn({ method: "POST" })
  .validator(
    (data: { eventSlug: string; token: string; requestId: number; approve: boolean }) => data,
  )
  .handler(({ data }) =>
    runScoring((scoring) => scoring.decideStaffGuest({ ...data, deviceId: ensureDeviceId() })),
  );

export const transferStaffPointsFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      token: string;
      fromParticipantId: string;
      toParticipantId: string;
      points: number;
      commandId: string;
      note: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    const result = await runScoring((scoring) =>
      scoring.transferStaffPoints({ ...data, deviceId: ensureDeviceId() }),
    );
    return result.ok ? { ok: true as const, value: { id: result.value.id } } : result;
  });

export const acceptStaffHeldActionFn = createServerFn({ method: "POST" })
  .validator(
    (data: { eventSlug: string; token: string; transactionId: string; note: string }) => data,
  )
  .handler(async ({ data }) => {
    const result = await runScoring((scoring) =>
      scoring.acceptStaffHeldAction({ ...data, deviceId: ensureDeviceId() }),
    );
    return result.ok ? { ok: true as const, value: { id: result.value.id } } : result;
  });

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
  .handler(({ data }) =>
    runScoring((scoring) => scoring.setStaffGuestPhotos({ ...data, deviceId: ensureDeviceId() })),
  );

export const reserveOfflineScoreBudgetFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      token: string;
      activityId: string;
      points: number;
      expiresInMinutes?: number;
    }) => data,
  )
  .handler(({ data }) =>
    runScoring((scoring) => scoring.reserveOfflineBudget({ ...data, deviceId: ensureDeviceId() })),
  );

export const reconcileOfflineScoreCommandsFn = createServerFn({ method: "POST" })
  .validator(
    (data: {
      eventSlug: string;
      token: string;
      reservationId: string;
      commands: OfflineScoreCommand[];
    }) => data,
  )
  .handler(({ data }) =>
    runScoring((scoring) =>
      scoring.reconcileOfflineCommands({ ...data, deviceId: ensureDeviceId() }),
    ),
  );

export const closeOfflineScoreReservationFn = createServerFn({ method: "POST" })
  .validator((data: { eventSlug: string; token: string; reservationId: string }) => data)
  .handler(({ data }) =>
    runScoring((scoring) =>
      scoring.closeOfflineReservation({ ...data, deviceId: ensureDeviceId() }),
    ),
  );
