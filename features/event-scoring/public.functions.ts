import { createServerFn } from "@tanstack/react-start";

import { getDiscovery } from "./discoveries.server";
import { publicLeaderboard } from "./scoring.server";
import { activeParticipantForEvent } from "./session.server";

function identifier(value: unknown, label: string) {
  if (typeof value !== "string") throw new Error(`${label} is missing`);
  const result = value.trim();
  if (!result || result.length > 160) throw new Error(`${label} is invalid`);
  return result;
}

export const getPublicLeaderboardFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown } | null;
    return { eventSlug: identifier(input?.eventSlug, "Event") };
  })
  .handler(async ({ data }) =>
    publicLeaderboard({
      eventSlug: data.eventSlug,
      currentParticipantId: await activeParticipantForEvent(data.eventSlug),
      includePreview: false,
    }),
  );

export const getPublicDiscoveryFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown; discoveryId?: unknown } | null;
    return {
      eventSlug: identifier(input?.eventSlug, "Event"),
      discoveryId: identifier(input?.discoveryId, "Discovery"),
    };
  })
  .handler(async ({ data }) => {
    const discovery = await getDiscovery(data.discoveryId);
    if (!discovery || discovery.eventSlug !== data.eventSlug) return null;
    return {
      discovery,
      activeParticipantId: await activeParticipantForEvent(data.eventSlug),
    };
  });

export const getDiscoveryClaimPageFn = createServerFn({ method: "GET" })
  .validator((value: unknown) => {
    const input = value as { eventSlug?: unknown } | null;
    return { eventSlug: identifier(input?.eventSlug, "Event") };
  })
  .handler(async ({ data }) => ({
    activeParticipant: Boolean(await activeParticipantForEvent(data.eventSlug)),
  }));
