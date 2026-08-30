import { createServerFn } from "@tanstack/react-start";

import {
  closeGroupGameClaimSession,
  openGroupGameClaimSession,
} from "@/features/event-scoring/group-game-claims.server";
import {
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerText,
} from "../shared/multiplayer-validation";
import { readFamilyFeudSnapshot } from "./family-feud-room.server";
import type { FamilyFeudTeamId } from "./types";

function teamId(value: unknown): FamilyFeudTeamId {
  if (value !== "one" && value !== "two") throw new Error("Invalid team");
  return value;
}

export const openFamilyFeudTeamClaimSessionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      controllerToken: multiplayerCredential(data.controllerToken),
      teamId: teamId(data.teamId),
    };
  })
  .handler(async ({ data }) => {
    const current = await readFamilyFeudSnapshot({
      roomId: data.roomId,
      role: "controller",
      credential: data.controllerToken,
    });
    if (!current.ok)
      return { ok: false as const, status: 404, error: "Family Feud room unavailable" };
    const snapshot = current.snapshot;
    if (!snapshot || snapshot.phase !== "finished" || !snapshot.resultConfirmed)
      return { ok: false as const, status: 409, error: "Confirm the final result first" };
    if (!snapshot.eventScoring)
      return { ok: false as const, status: 409, error: "Event scoring is not on for this game" };
    const selectedTeam = snapshot.teams.find(({ id }) => id === data.teamId)!;
    const opened = await openGroupGameClaimSession({
      gameKind: "family-feud",
      gameInstanceId: snapshot.roomId,
      resultId: `game:${snapshot.gameNumber}`,
      groupKey: data.teamId,
      groupName: selectedTeam.name,
      gamePlayerPrefix: `team:${data.teamId}:slot:`,
      maximumClaims: selectedTeam.playerCount,
    });
    if (!opened.ok) return opened;
    const tokenFragment = new URLSearchParams({ claim: opened.value.token }).toString();
    return {
      ok: true as const,
      value: {
        ...opened.value.session,
        claimPath: `/events/${encodeURIComponent(opened.value.session.eventSlug)}/game-result-claim#${tokenFragment}`,
      },
    };
  });

export const closeFamilyFeudTeamClaimSessionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = multiplayerRecord(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      controllerToken: multiplayerCredential(data.controllerToken),
      sessionId: multiplayerText(data.sessionId, 120),
    };
  })
  .handler(async ({ data }) => {
    const current = await readFamilyFeudSnapshot({
      roomId: data.roomId,
      role: "controller",
      credential: data.controllerToken,
    });
    if (!current.ok)
      return { ok: false as const, status: 404, error: "Family Feud room unavailable" };
    return closeGroupGameClaimSession({
      sessionId: data.sessionId,
      gameInstanceId: data.roomId,
    });
  });
