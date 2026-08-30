import type { CentreDifficulty, CentreRoomCredentials } from "@/features/things/centre/types";
import { createCentreRoom } from "@/features/things/centre/centre-room.server";
import { createTwinRoom } from "@/features/things/twin/twin-room.server";
import { createDrawCountryRoom } from "@/features/things/draw-country/draw-country-room.server";
import {
  createSameBrainRoom,
  joinSameBrainRoom,
} from "@/features/things/same-brain/same-brain-room.server";
import type { SameBrainToggles } from "@/features/things/same-brain/types";
import { createPartyRoom, joinPartyRoom } from "@/features/things/spelling-party/party-room.server";
import type { PartyCustomDeckInput } from "@/features/things/spelling-party/types";
import { createPairedGameRoom } from "@/features/things/remote/paired-game-room.server";
import type { RemoteHeadsUpSetup, RemoteSpellingSetup } from "@/features/things/remote/types";
import { createLiarsRoom, joinLiarsRoom } from "@/features/things/liars/liars-room.server";
import type {
  LiarsMode,
  LiarsRoomMode,
  LiarsTimings,
  LiarsToggles,
} from "@/features/things/liars/types";
import { createFamilyFeudRoom } from "@/features/things/family-feud/family-feud-room.server";
import type {
  FamilyFeudCustomDeckInput,
  FamilyFeudTeamId,
} from "@/features/things/family-feud/types";
import { query } from "@/lib/platform/postgres.server";
import {
  activateGameScoreBinding,
  createGameScoreBinding,
  ingestOfficialGameResult,
  linkGamePlayer,
  processOfficialGameResult,
} from "./games.server";
import { sealOfficialGameResult } from "@/features/game-results/outbox.server";
import { icebreakerEncounterPlayers, pitchesPlayersFromBallots } from "./managed-game-results";

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

export async function launchEventFamilyFeudGame(input: {
  eventSlug: string;
  activityId: string;
  deckId?: string;
  customDeck?: FamilyFeudCustomDeckInput;
  rounds?: number;
  mainSeconds?: number;
  stealSeconds?: number;
  firstTeamId?: FamilyFeudTeamId;
  teams: Array<{ name?: string; playerCount?: number }>;
}) {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: "family-feud",
    acceptedScope: "game",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createFamilyFeudRoom({
      deckId: input.deckId,
      customDeck: input.customDeck,
      rounds: input.rounds,
      mainSeconds: input.mainSeconds,
      stealSeconds: input.stealSeconds,
      firstTeamId: input.firstTeamId,
      teams: input.teams,
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
    return { ok: true as const, value: room };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Family Feud launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
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

async function launchEventPairedGame(input: {
  eventSlug: string;
  activityId: string;
  participantId: string;
  setup: RemoteHeadsUpSetup | RemoteSpellingSetup;
}) {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: input.setup.game,
    acceptedScope: "round",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createPairedGameRoom({
      creatorRole: "player",
      setup: input.setup,
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
      gamePlayerId: `player:${room.roomId}`,
      participantId: input.participantId,
    });
    if (!linked.ok) {
      await closeBinding(channelId, linked.error);
      return linked;
    }
    return { ok: true as const, value: room };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paired game launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
}

export function launchEventHeadsUpGame(input: {
  eventSlug: string;
  activityId: string;
  participantId: string;
  setup: RemoteHeadsUpSetup;
}) {
  return launchEventPairedGame(input);
}

export function launchEventSpellingBeeGame(input: {
  eventSlug: string;
  activityId: string;
  participantId: string;
  setup: RemoteSpellingSetup;
}) {
  return launchEventPairedGame(input);
}

export async function launchEventLiarsGame(input: {
  eventSlug: string;
  activityId: string;
  hostParticipantId: string;
  hostName: string;
  mode: LiarsMode;
  roomMode: LiarsRoomMode;
  toggles?: Partial<LiarsToggles>;
  timings?: Partial<LiarsTimings>;
}) {
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: "liars",
    acceptedScope: "game",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  try {
    const room = await createLiarsRoom({
      mode: input.mode,
      roomMode: input.roomMode,
      toggles: input.toggles,
      timings: input.timings,
      managed: true,
      officialResultChannelId: channelId,
    });
    const joined = await joinLiarsRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      hostToken: room.hostToken,
      name: input.hostName,
      joinId: `event-score:${channelId}`,
    });
    if (!joined.ok) {
      await closeBinding(channelId, joined.error);
      return { ok: false as const, status: 409, error: joined.error };
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
      ok: true as const,
      value: { ...room, playerId: joined.playerId, playerToken: joined.playerToken },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Liars game launch failed";
    await closeBinding(channelId, message);
    throw error;
  }
}

export async function confirmManagedEventGameResult(
  input:
    | {
        kind: "pitches";
        eventSlug: string;
        activityId: string;
        gameInstanceId: string;
        resultId: string;
        candidateParticipantIds: string[];
        ballots: Array<{ voterParticipantId: string; candidateParticipantId: string }>;
      }
    | {
        kind: "icebreaker";
        eventSlug: string;
        activityId: string;
        gameInstanceId: string;
        resultId: string;
        participantIds: string[];
      },
) {
  const result =
    input.kind === "pitches"
      ? pitchesPlayersFromBallots(input)
      : icebreakerEncounterPlayers(input.participantIds);
  if (!result.ok) return { ok: false as const, status: 400, error: result.error };
  const participantIds = [
    ...new Set(
      input.kind === "pitches"
        ? [
            ...input.candidateParticipantIds,
            ...input.ballots.map((ballot) => ballot.voterParticipantId),
          ]
        : input.participantIds,
    ),
  ];
  const eligible = await query<{ count: number }>(
    `select count(*)::integer as count from event_participants
      where event_slug = $1 and id = any($2::text[]) and status = 'active' and checked_in_at is not null`,
    [input.eventSlug, participantIds],
  );
  if (eligible[0]?.count !== participantIds.length)
    return { ok: false as const, status: 409, error: "Every player and voter must be checked in" };
  const existing = await query<{ id: string }>(
    `select results.id
       from official_game_results results
       join event_game_score_bindings bindings on bindings.channel_id = results.channel_id
       join events on events.event_id = bindings.event_id
      where events.slug = $1 and results.game_kind = $2 and results.game_instance_id = $3
        and results.result_id = $4
      order by results.revision desc limit 1`,
    [input.eventSlug, input.kind, input.gameInstanceId, input.resultId],
  );
  if (existing[0])
    return { ok: true as const, value: await processOfficialGameResult(existing[0].id) };
  const binding = await createGameScoreBinding({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    gameKind: input.kind,
    acceptedScope: input.kind === "pitches" ? "game" : "round",
  });
  if (!binding.ok) return binding;
  const channelId = binding.value.channelId;
  const activated = await activateGameScoreBinding({
    channelId,
    gameInstanceId: input.gameInstanceId,
  });
  if (!activated.ok) return activated;
  for (const player of result.players) {
    const linked = await linkGamePlayer({
      channelId,
      gamePlayerId: player.playerId,
      participantId: player.playerId,
    });
    if (!linked.ok) return linked;
  }
  const ingested = await ingestOfficialGameResult(
    sealOfficialGameResult({
      channelId,
      revision: 1,
      result: {
        gameKind: input.kind,
        gameInstanceId: input.gameInstanceId,
        resultId: input.resultId,
        scope: input.kind === "pitches" ? "game" : "round",
        players: result.players,
      },
    }),
  );
  if (!ingested.ok) return ingested;
  return { ok: true as const, value: await processOfficialGameResult(ingested.value.id) };
}
