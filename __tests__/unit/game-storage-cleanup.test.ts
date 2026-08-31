import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearExpiredGameLocalStorage,
  readExpiringLocalValue,
  readStorageValue,
  removeStorageKeys,
  writeExpiringLocalValue,
  writeStorageValue,
} from "../../features/things/shared/game-storage.client";

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
      "things:hot-and-cold:v2:room:CCC:player-session": JSON.stringify({
        expiresAt: Date.now() - 1_000,
        value: { playerId: "also-old" },
      }),
    });
    vi.stubGlobal("localStorage", storage);

    clearExpiredGameLocalStorage();

    expect(storage.map.has("things:liars:v1:room:AAA:player-session")).toBe(false);
    expect(storage.map.has("things:liars:v1:room:BBB:player-session")).toBe(true);
    expect(storage.map.has("things:hot-and-cold:v2:room:CCC:player-session")).toBe(false);
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

  it("keeps storage failures from interrupting a live game", () => {
    const blocked = {
      get length(): number {
        throw new Error("storage blocked");
      },
      key: () => {
        throw new Error("storage blocked");
      },
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
      removeItem: () => {
        throw new Error("storage blocked");
      },
      clear: () => {
        throw new Error("storage blocked");
      },
    } as Storage;
    vi.stubGlobal("localStorage", blocked);

    expect(readExpiringLocalValue("things:twin:v1:room:ABC2345:player-session")).toBeNull();
    expect(
      writeExpiringLocalValue(
        "things:twin:v1:room:ABC2345:player-session",
        { playerId: "one" },
        Date.now() + 1_000,
      ),
    ).toBe(false);
    expect(() => removeStorageKeys(blocked, ["one", "two"])).not.toThrow();
    expect(readStorageValue(blocked, "one")).toBeNull();
    expect(writeStorageValue(blocked, "one", "value")).toBe(false);
    expect(() => clearExpiredGameLocalStorage()).not.toThrow();
  });

  it("safely discards a corrupt expiring recovery record", () => {
    const key = "things:twin:v1:room:ABC2345:player-session";
    const storage = fakeStorage({ [key]: "not-json" });
    vi.stubGlobal("localStorage", storage);

    expect(readExpiringLocalValue(key)).toBeNull();
    expect(storage.map.has(key)).toBe(false);
  });
});
