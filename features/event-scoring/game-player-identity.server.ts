import type { OfficialGameKind } from "@/features/game-results/types";
import { log } from "@/lib/platform/logger.server";
import { queryOne } from "@/lib/platform/postgres.server";
import { linkGamePlayer } from "./games.server";
import { activeParticipantForEvent } from "./session.server";

/**
 * Connects an authenticated game join to the attendee's sole active event participant.
 * Typed names never participate in this decision; ambiguous multi-ticket accounts must choose a
 * ticket explicitly before the game can award points automatically.
 */
export async function linkCurrentAttendeeGamePlayer(input: {
  gameKind: OfficialGameKind;
  gameInstanceId: string;
  gamePlayerId: string;
}): Promise<void> {
  const binding = await queryOne<{ event_slug: string; channel_id: string }>(
    `select events.slug as event_slug,bindings.channel_id
       from event_game_score_bindings bindings
       join events on events.event_id = bindings.event_id
      where bindings.game_kind = $1 and bindings.game_instance_id = $2
        and bindings.status = 'active'`,
    [input.gameKind, input.gameInstanceId],
  );
  if (!binding) return;
  const participantId = await activeParticipantForEvent(binding.event_slug);
  if (!participantId) return;
  const linked = await linkGamePlayer({
    channelId: binding.channel_id,
    gamePlayerId: input.gamePlayerId,
    participantId,
  });
  if (!linked.ok)
    log.warn("event-game.identity", "Could not link signed-in game player", {
      gameKind: input.gameKind,
      gameInstanceId: input.gameInstanceId,
      eventSlug: binding.event_slug,
      status: linked.status,
    });
}
