import { centreBrowserKeys } from "../centre/centre-keys";
import type { CentrePlayerCredentials } from "../centre/types";
import { drawCountryBrowserKeys } from "../draw-country/draw-country-keys";
import type { DrawCountryPlayerCredentials } from "../draw-country/types";
import { liarsBrowserKeys } from "../liars/liars-keys";
import type { LiarsPlayerCredentials } from "../liars/types";
import { sameBrainBrowserKeys } from "../same-brain/same-brain-keys";
import type { SameBrainPlayerCredentials } from "../same-brain/types";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { gameBrowserKey } from "../shared/multiplayer-keys";
import { twinBrowserKeys } from "../twin/twin-keys";
import type { TwinPlayerCredentials } from "../twin/types";
import type { GamePoolAssignment, GamePoolGame } from "./types";
import { releaseGamePoolAssignmentFn } from "./pool.functions";

interface GamePoolMembership {
  token: string;
  clientId: string;
}

export const gamePoolMembershipKey = (game: GamePoolGame, roomId: string) =>
  gameBrowserKey("game-pool", 1, game, "room", roomId, "membership");

export function gamePoolRoomInvitePath(token: string, roomId: string) {
  return `/play/${encodeURIComponent(token)}?room=${encodeURIComponent(roomId)}`;
}

export function gamePoolRoomInviteUrl(game: GamePoolGame, roomId: string) {
  if (typeof window === "undefined") return null;
  const membership = readExpiringLocalValue<GamePoolMembership>(
    gamePoolMembershipKey(game, roomId),
  );
  return membership
    ? new URL(gamePoolRoomInvitePath(membership.token, roomId), window.location.origin).toString()
    : null;
}

export function gamePoolClientId() {
  const key = gameBrowserKey("game-pool", 1, "client-id");
  try {
    const stored = localStorage.getItem(key);
    if (stored && stored.length >= 12) return stored;
    const created = crypto.randomUUID().replaceAll("-", "");
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID().replaceAll("-", "");
  }
}

export function adoptGamePoolAssignment(
  assignment: GamePoolAssignment,
  membership: GamePoolMembership,
) {
  if (assignment.game === "same-brain") {
    const credentials: SameBrainPlayerCredentials = {
      roomId: assignment.roomId,
      expiresAt: assignment.expiresAt,
      playerId: assignment.playerId,
      playerToken: assignment.playerToken,
      snapshot: assignment.snapshot,
    };
    writeExpiringLocalValue(
      sameBrainBrowserKeys.playerSession(assignment.roomId),
      credentials,
      assignment.expiresAt,
    );
  } else if (assignment.game === "liars") {
    const credentials: LiarsPlayerCredentials = {
      roomId: assignment.roomId,
      expiresAt: assignment.expiresAt,
      playerId: assignment.playerId,
      playerToken: assignment.playerToken,
      snapshot: assignment.snapshot,
    };
    writeExpiringLocalValue(
      liarsBrowserKeys.playerSession(assignment.roomId),
      credentials,
      assignment.expiresAt,
    );
  } else if (assignment.game === "centre") {
    const credentials: CentrePlayerCredentials = assignment;
    writeExpiringLocalValue(
      centreBrowserKeys.playerSession(assignment.roomId),
      credentials,
      assignment.expiresAt,
    );
  } else if (assignment.game === "twin") {
    const credentials: TwinPlayerCredentials = assignment;
    writeExpiringLocalValue(
      twinBrowserKeys.playerSession(assignment.roomId),
      credentials,
      assignment.expiresAt,
    );
  } else {
    const credentials: DrawCountryPlayerCredentials = assignment;
    writeExpiringLocalValue(
      drawCountryBrowserKeys.playerSession(assignment.roomId),
      credentials,
      assignment.expiresAt,
    );
  }
  writeExpiringLocalValue(
    gamePoolMembershipKey(assignment.game, assignment.roomId),
    membership,
    assignment.expiresAt,
  );
}

export function gamePoolPlayerPath(assignment: GamePoolAssignment) {
  return `/things/${assignment.game}/${assignment.roomId}`;
}

export async function releaseGamePoolMembership(game: GamePoolGame, roomId: string) {
  const key = gamePoolMembershipKey(game, roomId);
  const membership = readExpiringLocalValue<GamePoolMembership>(key);
  if (!membership) return null;
  try {
    await releaseGamePoolAssignmentFn({ data: membership });
  } finally {
    localStorage.removeItem(key);
  }
  return `/play/${encodeURIComponent(membership.token)}?choose=1`;
}
