import type { CentreDifficulty, CentreRoomCredentials } from "@/features/things/centre/types";
import { createCentreRoom } from "@/features/things/centre/centre-room.server";
import { createTwinRoom } from "@/features/things/twin/twin-room.server";
import { createDrawCountryRoom } from "@/features/things/draw-country/draw-country-room.server";
import {
  createSameBrainRoom,
  joinSameBrainRoom,
} from "@/features/things/same-brain/same-brain-room.server";
import type { SameBrainScoring, SameBrainToggles } from "@/features/things/same-brain/types";
import { createPartyRoom, joinPartyRoom } from "@/features/things/spelling-party/party-room.server";
import type { PartyCustomDeckInput } from "@/features/things/spelling-party/types";
import { query } from "@/lib/platform/postgres.server";
import { activateGameScoreBinding, createGameScoreBinding, linkGamePlayer } from "./games.server";

async function closeBinding(channelId: string, reason: string) {
  await query(
    `update event_game_score_bindings
        set status = 'closed', updated_at = now()
      where channel_id = $1`,
    [channelId],
  );
  await query(
    `insert into score_audit_events
       (event_slug, action, actor_type, entity_type, entity_id, metadata)
     select events.slug, 'game.binding.launch-failed', 'system', 'game_binding', $1, $2::jsonb
       from event_game_score_bindings bindings
       join events on events.event_id = bindings.event_id
      where bindings.channel_id = $1`,
    [channelId, JSON.stringify({ reason })],
  );
}

export async function launchEventCentreGame(input: {
  eventSlug: string;
  activityId: string;
  hostParticipantId: string;
  hostName: string;
  difficulty: CentreDifficulty;
  delayedRivals: boolean;
}): Promise<
  { ok: true; value: CentreRoomCredentials } | { ok: false; status: number; error: string }
> {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: "centre",
    acceptedScope: "game",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createCentreRoom({
      hostName: input.hostName,
      difficulty: input.difficulty,
      delayedRivals: input.delayedRivals,
      managed: true,
      officialResultChannelId: channelId,
    });
    const activated = await activateGameScoreBinding({
      channelId,
      gameInstanceId: room.roomId,
    });
    if (!activated.ok) {
      await closeBinding(channelId, activated.error);
      return activated;
    }
    const linked = await linkGamePlayer({
      channelId,
      gamePlayerId: room.playerId,
      participantId: input.hostParticipantId,
    });
    if (!linked.ok) {
      await closeBinding(channelId, linked.error);
      return linked;
    }
    return { ok: true, value: room };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Centre game launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
}

export async function launchEventTwinGame(input: {
  eventSlug: string;
  activityId: string;
  hostParticipantId: string;
  hostName: string;
  handSize?: number;
}): Promise<
  | { ok: true; value: Awaited<ReturnType<typeof createTwinRoom>> }
  | { ok: false; status: number; error: string }
> {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: "twin",
    acceptedScope: "game",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createTwinRoom({
      hostName: input.hostName,
      handSize: input.handSize,
      managed: true,
      officialResultChannelId: channelId,
    });
    const activated = await activateGameScoreBinding({
      channelId,
      gameInstanceId: room.roomId,
    });
    if (!activated.ok) {
      await closeBinding(channelId, activated.error);
      return activated;
    }
    const linked = await linkGamePlayer({
      channelId,
      gamePlayerId: room.playerId,
      participantId: input.hostParticipantId,
    });
    if (!linked.ok) {
      await closeBinding(channelId, linked.error);
      return linked;
    }
    return { ok: true, value: room };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Twin game launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
}

export async function launchEventDrawCountryGame(input: {
  eventSlug: string;
  activityId: string;
  hostParticipantId: string;
  hostName: string;
  drawSeconds: number;
  roundTotal: number;
}): Promise<
  | { ok: true; value: Awaited<ReturnType<typeof createDrawCountryRoom>> }
  | { ok: false; status: number; error: string }
> {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: "draw-country",
    acceptedScope: "game",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createDrawCountryRoom({
      hostName: input.hostName,
      drawSeconds: input.drawSeconds,
      roundTotal: input.roundTotal,
      recentCountryIds: [],
      managed: true,
      officialResultChannelId: channelId,
    });
    const activated = await activateGameScoreBinding({
      channelId,
      gameInstanceId: room.roomId,
    });
    if (!activated.ok) {
      await closeBinding(channelId, activated.error);
      return activated;
    }
    const linked = await linkGamePlayer({
      channelId,
      gamePlayerId: room.playerId,
      participantId: input.hostParticipantId,
    });
    if (!linked.ok) {
      await closeBinding(channelId, linked.error);
      return linked;
    }
    return { ok: true, value: room };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draw Country game launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
}

export async function launchEventSameBrainGame(input: {
  eventSlug: string;
  activityId: string;
  hostParticipantId: string;
  hostName: string;
  rounds?: number;
  scoring?: SameBrainScoring;
  toggles?: Partial<SameBrainToggles>;
}): Promise<
  | {
      ok: true;
      value: Awaited<ReturnType<typeof createSameBrainRoom>> & {
        playerId: string;
        playerToken: string;
      };
    }
  | { ok: false; status: number; error: string }
> {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: "same-brain",
    acceptedScope: "game",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createSameBrainRoom({
      rounds: input.rounds,
      scoring: input.scoring,
      toggles: input.toggles,
      managed: true,
      officialResultChannelId: channelId,
    });
    const joined = await joinSameBrainRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      hostToken: room.hostToken,
      name: input.hostName,
      joinId: `event-score:${channelId}`,
    });
    if (!joined.ok) {
      await closeBinding(channelId, joined.error);
      return { ok: false, status: 409, error: joined.error };
    }
    const activated = await activateGameScoreBinding({
      channelId,
      gameInstanceId: room.roomId,
    });
    if (!activated.ok) {
      await closeBinding(channelId, activated.error);
      return activated;
    }
    const linked = await linkGamePlayer({
      channelId,
      gamePlayerId: joined.playerId,
      participantId: input.hostParticipantId,
    });
    if (!linked.ok) {
      await closeBinding(channelId, linked.error);
      return linked;
    }
    return {
      ok: true,
      value: { ...room, playerId: joined.playerId, playerToken: joined.playerToken },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Same Brain game launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
}

export async function launchEventSpellingPartyGame(input: {
  eventSlug: string;
  activityId: string;
  hostParticipantId: string;
  hostName: string;
  deckId: string;
  customDeck?: PartyCustomDeckInput;
  answerSeconds: number;
  roundTotal: number;
}): Promise<
  | {
      ok: true;
      value: Awaited<ReturnType<typeof createPartyRoom>> & {
        playerId: string;
        playerToken: string;
      };
    }
  | { ok: false; status: number; error: string }
> {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: "spelling-party",
    acceptedScope: "game",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createPartyRoom({
      deckId: input.deckId,
      customDeck: input.customDeck,
      answerSeconds: input.answerSeconds,
      roundTotal: input.roundTotal,
      officialResultChannelId: channelId,
    });
    const joined = await joinPartyRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: input.hostName,
      joinId: `event-score:${channelId}`,
    });
    if (!joined.ok) {
      await closeBinding(channelId, joined.error);
      return { ok: false, status: 409, error: joined.error };
    }
    const activated = await activateGameScoreBinding({
      channelId,
      gameInstanceId: room.roomId,
    });
    if (!activated.ok) {
      await closeBinding(channelId, activated.error);
      return activated;
    }
    const linked = await linkGamePlayer({
      channelId,
      gamePlayerId: joined.playerId,
      participantId: input.hostParticipantId,
    });
    if (!linked.ok) {
      await closeBinding(channelId, linked.error);
      return linked;
    }
    return {
      ok: true,
      value: { ...room, playerId: joined.playerId, playerToken: joined.playerToken },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Spelling Party launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
}
