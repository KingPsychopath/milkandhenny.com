import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeRoomMatchesPath,
  activeRoomPath,
  readActiveRooms,
} from "../../features/things/shared/active-room-recovery";

function fakeStorage(entries: Record<string, string> = {}) {
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
  };
}

function live(value: object) {
  return JSON.stringify({ expiresAt: Date.now() + 60_000, value });
}

describe("active room notice", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("sessionStorage", fakeStorage());
  });

  it("returns presenters and controllers to their own surfaces", () => {
    expect(activeRoomPath("spelling-party", "ABC2345", "presenter-recovery")).toBe(
      "/things/spelling-party/ABC2345/present",
    );
    expect(activeRoomPath("family-feud", "DEF2345", "presenter-recovery")).toBe(
      "/things/family-feud/DEF2345/present",
    );
    expect(activeRoomPath("family-feud", "DEF2345", "controller-session")).toBe(
      "/things/family-feud/DEF2345/control",
    );
  });

  it("treats every role surface for the same room as the current room", () => {
    const controllerRoom = {
      game: "family-feud" as const,
      label: "family feud",
      path: "/things/family-feud/DEF2345/control",
      roomId: "DEF2345",
    };

    expect(activeRoomMatchesPath(controllerRoom, "/things/family-feud/DEF2345/present")).toBe(true);
    expect(activeRoomMatchesPath(controllerRoom, "/things/family-feud/DEF2345/control")).toBe(true);
    expect(activeRoomMatchesPath(controllerRoom, "/things/family-feud/OTHER12/present")).toBe(
      false,
    );
  });

  it("discovers every durable room role without treating a presenter as a player", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({
        "things:spelling-party:v2:room:ABC2345:presenter-recovery": live({ token: "one" }),
        "things:family-feud:v1:room:DEF2345:controller-session": live({ token: "two" }),
        "things:family-feud:v1:room:GHI2345:presenter-recovery": live({ token: "three" }),
        "things:hot-and-cold:v2:room:JKL2345:player-session": live({ token: "four" }),
      }),
    );

    expect(readActiveRooms().map(({ path }) => path)).toEqual([
      "/things/family-feud/DEF2345/control",
      "/things/family-feud/GHI2345/present",
      "/things/hot-and-cold/JKL2345",
      "/things/spelling-party/ABC2345/present",
    ]);
    expect(readActiveRooms().map(({ label }) => label)).toEqual([
      "family feud MC",
      "family feud TV",
      "hot & cold",
      "spelling party TV",
    ]);
  });

  it("still finds a live room immediately after removing an expired neighbour", () => {
    vi.stubGlobal(
      "localStorage",
      fakeStorage({
        "things:twin:v1:room:OLD2345:player-session": JSON.stringify({
          expiresAt: Date.now() - 1,
          value: { token: "old" },
        }),
        "things:twin:v1:room:NEW2345:player-session": live({ token: "new" }),
      }),
    );

    expect(readActiveRooms().map(({ path }) => path)).toEqual(["/things/twin/NEW2345"]);
  });
});
