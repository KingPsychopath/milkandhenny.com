import type { CentreDifficulty, CentreRoomCredentials } from "@/features/things/centre/types";
import { createCentreRoom } from "@/features/things/centre/centre-room.server";
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
