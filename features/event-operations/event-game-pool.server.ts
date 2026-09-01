import { findAutomaticPooledEventGame } from "@/features/event-scoring/event-games.server";
import { linkCurrentAttendeeGamePlayer } from "@/features/event-scoring/game-player-identity.server";
import { launchAutomaticEventPoolRoom } from "@/features/event-scoring/game-launch.server";
import { activeParticipantForEvent } from "@/features/event-scoring/session.server";
import type { AssignGamePoolRoomInput } from "@/features/things/pool/pool.server";

const SUPPORTED = new Set(["centre", "same-brain", "draw-country", "hot-and-cold"]);

export async function eventGamePoolHooks(
  token: string,
): Promise<Pick<AssignGamePoolRoomInput, "createRoom" | "afterAssignment">> {
  const registration = await findAutomaticPooledEventGame(token);
  if (!registration || !SUPPORTED.has(registration.game_key)) return {};
  const gameKind = registration.game_key as
    | "centre"
    | "same-brain"
    | "draw-country"
    | "hot-and-cold";
  return {
    createRoom: (room) =>
      launchAutomaticEventPoolRoom({
        ...room,
        eventSlug: registration.event_slug,
        activityId: registration.activity_id,
      }),
    afterAssignment: (assignment) =>
      linkCurrentAttendeeGamePlayer({
        gameKind,
        gameInstanceId: assignment.roomId,
        gamePlayerId: assignment.playerId,
      }),
  };
}

export async function eventGamePoolPublicScoring(token: string) {
  const registration = await findAutomaticPooledEventGame(token);
  if (!registration || !SUPPORTED.has(registration.game_key)) return undefined;
  return {
    completionPoints: 2,
    winnerTotalPoints: 10,
    eligible: Boolean(await activeParticipantForEvent(registration.event_slug)),
  };
}
