import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearExpiredGameLocalStorage } from "../../features/things/shared/game-storage.client";

/**
 * The cleanup used to remove anything under a game prefix that did not parse as an expiring record,
 * which took preferences, notepads and the sound setting with it. Opening one game wiped another
 * game's settings — indistinguishable, from the outside, from persistence never having worked.
 */
function fakeStorage(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries));
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

describe("expired game storage cleanup", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("removes only room sessions that have actually expired", () => {
    const storage = fakeStorage({
      "things:liars:v1:room:AAA:player-session": JSON.stringify({
        expiresAt: Date.now() - 1_000,
        value: { playerId: "old" },
      }),
      "things:liars:v1:room:BBB:player-session": JSON.stringify({
        expiresAt: Date.now() + 60_000,
        value: { playerId: "live" },
      }),
    });
    vi.stubGlobal("localStorage", storage);

    clearExpiredGameLocalStorage();

    expect(storage.map.has("things:liars:v1:room:AAA:player-session")).toBe(false);
    expect(storage.map.has("things:liars:v1:room:BBB:player-session")).toBe(true);
  });

  it("leaves everything that was never meant to expire", () => {
    const storage = fakeStorage({
      // A plain object with no expiry.
      "things:liars:v1:preferences": JSON.stringify({ mode: "imposter", players: 13 }),
      // A bare string, which is not JSON at all.
      "things:liars:v1:sound-muted": "ambient",
      // An array.
      "things:liars:v1:room:AAA:player:P:notes:1": JSON.stringify([
        { id: "1", round: 2, text: "maya went quiet" },
      ]),
      "things:spelling-party:v1:sound-muted": "off",
    });
    vi.stubGlobal("localStorage", storage);

    clearExpiredGameLocalStorage();

    expect(storage.map.size, "opening one game must not wipe another's settings").toBe(4);
  });

  it("still ignores keys belonging to anything else on the origin", () => {
    const storage = fakeStorage({ "unrelated:thing": "kept" });
    vi.stubGlobal("localStorage", storage);
    clearExpiredGameLocalStorage();
    expect(storage.map.has("unrelated:thing")).toBe(true);
  });
});
