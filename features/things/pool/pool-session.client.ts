import { centreBrowserKeys } from "../centre/centre-keys";
import type { CentrePlayerCredentials } from "../centre/types";
import { drawCountryBrowserKeys } from "../draw-country/draw-country-keys";
import type { DrawCountryPlayerCredentials } from "../draw-country/types";
import { liarsBrowserKeys } from "../liars/liars-keys";
import type { LiarsPlayerCredentials } from "../liars/types";
import { hotAndColdBrowserKeys } from "../hot-and-cold/hot-and-cold-keys";
import type { HotAndColdCredentials } from "../hot-and-cold/types";
import { sameBrainBrowserKeys } from "../same-brain/same-brain-keys";
import type { SameBrainPlayerCredentials } from "../same-brain/types";
import { readExpiringLocalValue, writeExpiringLocalValue } from "../shared/game-storage.client";
import { gameBrowserKey } from "../shared/multiplayer-keys";
import { twinBrowserKeys } from "../twin/twin-keys";
import type { TwinPlayerCredentials } from "../twin/types";
import type { GamePoolAssignment, GamePoolGame } from "./types";
import { releaseGamePoolAssignmentFn } from "./pool.functions";
import { removeStorageKeys } from "../shared/game-storage.client";

interface GamePoolMembership {
  token: string;
  clientId: string;
}

interface ActiveGamePoolMembership extends GamePoolMembership {
  roomId: string;
}

export const gamePoolMembershipKey = (game: GamePoolGame, roomId: string) =>
  gameBrowserKey("game-pool", 1, game, "room", roomId, "membership");

export const gamePoolActiveMembershipKey = (game: GamePoolGame) =>
  gameBrowserKey("game-pool", 1, game, "active-membership");

export function readActiveGamePoolMembership(game: GamePoolGame, token?: string) {
  if (typeof window === "undefined") return null;
  const active = readExpiringLocalValue<ActiveGamePoolMembership>(
    gamePoolActiveMembershipKey(game),
  );
  if (active && (!token || active.token === token)) return active;

  // The room record is enough to recover after an interrupted write of the active marker.
  const roomPrefix = gameBrowserKey("game-pool", 1, game, "room");
  const roomSuffix = ":membership";
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(`${roomPrefix}:`) || !key.endsWith(roomSuffix)) continue;
      const roomId = key.slice(roomPrefix.length + 1, -roomSuffix.length);
      const membership = readExpiringLocalValue<GamePoolMembership>(key);
      if (membership && roomId && (!token || membership.token === token))
        return { ...membership, roomId };
    }
  } catch {
    // Browsing and leaving must also work when the browser blocks persistence.
    return null;
  }
  return null;
}

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
  } else if (assignment.game === "hot-and-cold") {
    const credentials: HotAndColdCredentials = assignment;
    writeExpiringLocalValue(
      hotAndColdBrowserKeys.playerSession(assignment.roomId),
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
  writeExpiringLocalValue(
    gamePoolActiveMembershipKey(assignment.game),
    { ...membership, roomId: assignment.roomId } satisfies ActiveGamePoolMembership,
    assignment.expiresAt,
  );
}

export function forgetGamePoolRoomMembership(game: GamePoolGame, roomId: string) {
  if (typeof window === "undefined") return;
  const active = readActiveGamePoolMembership(game);
  removeStorageKeys(localStorage, [
    gamePoolMembershipKey(game, roomId),
    ...(active?.roomId === roomId ? [gamePoolActiveMembershipKey(game)] : []),
  ]);
}

export async function releaseGamePoolMembership(game: GamePoolGame, roomId: string) {
  const key = gamePoolMembershipKey(game, roomId);
  const active = readActiveGamePoolMembership(game);
  const membership =
    readExpiringLocalValue<GamePoolMembership>(key) ?? (active?.roomId === roomId ? active : null);
  if (!membership) return null;
  // Clear recovery before the request, including when a connection never answers.
  forgetGamePoolRoomMembership(game, roomId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    await Promise.race([
      releaseGamePoolAssignmentFn({ data: membership, signal: controller.signal }).catch(
        () => undefined,
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve();
        }, 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  return `/play/${encodeURIComponent(membership.token)}`;
}

export async function clearUnavailableGamePoolMembership(game: GamePoolGame, roomId: string) {
  await leaveGamePoolRoom(game, roomId);
}

export async function leaveGamePoolRoom(game: GamePoolGame, roomId: string) {
  try {
    return await releaseGamePoolMembership(game, roomId);
  } catch {
    // Leaving must remain local-first. A failed pool request must not trap someone in a room they
    // already left or keep its recovery marker alive; the server assignment expires independently.
    return null;
  } finally {
    forgetGamePoolRoomMembership(game, roomId);
  }
}
