import { useCallback, useMemo } from "react";

import type { MultiplayerJoinAttempt } from "./multiplayer";
import { gameBrowserKey } from "./multiplayer-keys";

const JOIN_ATTEMPT_TTL_MS = 10 * 60 * 1_000;

export function createMultiplayerBrowserCredential() {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");
}

function createJoinAttempt(): MultiplayerJoinAttempt {
  return {
    joinId: crypto.randomUUID(),
    playerToken: createMultiplayerBrowserCredential(),
  };
}

export function multiplayerJoinAttemptKey(game: string, version: number, roomId: string) {
  return gameBrowserKey(game, version, "room", roomId, "join-attempt");
}

export function readOrCreateMultiplayerJoinAttempt(key: string): MultiplayerJoinAttempt {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    const joinId = stored && typeof stored === "object" ? Reflect.get(stored, "joinId") : null;
    const playerToken =
      stored && typeof stored === "object" ? Reflect.get(stored, "playerToken") : null;
    const expiresAt =
      stored && typeof stored === "object" ? Reflect.get(stored, "expiresAt") : null;
    if (
      stored &&
      typeof stored === "object" &&
      !Array.isArray(stored) &&
      typeof joinId === "string" &&
      typeof playerToken === "string" &&
      typeof expiresAt === "number" &&
      expiresAt > Date.now()
    )
      return { joinId, playerToken };
  } catch {
    // Session storage is an optimization. The in-memory value still protects retries in this view.
  }

  const attempt = createJoinAttempt();
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({ ...attempt, expiresAt: Date.now() + JOIN_ATTEMPT_TTL_MS }),
    );
  } catch {
    // Private browsing can block storage; the component retains this attempt in React state.
  }
  return attempt;
}

export function clearMultiplayerJoinAttempt(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage is optional.
  }
}

export function useMultiplayerJoinAttempt(game: string, version: number, roomId: string) {
  const key = multiplayerJoinAttemptKey(game, version, roomId);
  const attempt = useMemo(() => readOrCreateMultiplayerJoinAttempt(key), [key]);
  const clear = useCallback(() => clearMultiplayerJoinAttempt(key), [key]);
  return { attempt, clear };
}
