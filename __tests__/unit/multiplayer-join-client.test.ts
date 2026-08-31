import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearMultiplayerJoinAttempt,
  multiplayerJoinAttemptKey,
  readOrCreateMultiplayerJoinAttempt,
} from "../../features/things/shared/multiplayer-join.client";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    map,
  };
}

describe("multiplayer browser join attempts", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("keeps one credential across retries and discards it after a successful join", () => {
    const storage = fakeStorage();
    vi.stubGlobal("sessionStorage", storage);
    const key = multiplayerJoinAttemptKey("twin", 1, "ABC2345");

    const first = readOrCreateMultiplayerJoinAttempt(key);
    const retry = readOrCreateMultiplayerJoinAttempt(key);
    expect(retry).toEqual(first);
    expect(first.playerToken.length).toBeGreaterThan(40);

    clearMultiplayerJoinAttempt(key);
    const nextJoin = readOrCreateMultiplayerJoinAttempt(key);
    expect(nextJoin.joinId).not.toBe(first.joinId);
    expect(nextJoin.playerToken).not.toBe(first.playerToken);
  });

  it("replaces an expired attempt instead of reviving stale credentials", () => {
    const storage = fakeStorage();
    const key = multiplayerJoinAttemptKey("centre", 1, "DEF2345");
    storage.setItem(
      key,
      JSON.stringify({ joinId: "old", playerToken: "old-token", expiresAt: Date.now() - 1 }),
    );
    vi.stubGlobal("sessionStorage", storage);

    expect(readOrCreateMultiplayerJoinAttempt(key)).not.toMatchObject({ joinId: "old" });
  });
});
