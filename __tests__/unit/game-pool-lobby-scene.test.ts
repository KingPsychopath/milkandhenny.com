import { describe, expect, it } from "vitest";

import { buildGamePoolLobbyScene, gamePoolLobbyStatus } from "@/features/things/pool/lobby-scene";
import type { GamePoolRoomSummary } from "@/features/things/pool/types";

function room(roomId: string, input: Partial<GamePoolRoomSummary> = {}): GamePoolRoomSummary {
  return {
    roomId,
    label: roomId,
    status: "open",
    playerCount: 0,
    capacity: 6,
    occupants: [],
    createdAt: "2026-08-24T00:00:00.000Z",
    ...input,
  };
}

describe("game-pool lobby scene", () => {
  it("keeps open rooms visible before rooms that are already playing", () => {
    const scene = buildGamePoolLobbyScene([
      room("playing-1", { status: "started", playerCount: 4 }),
      room("waiting-1", { playerCount: 2 }),
      room("waiting-2", { playerCount: 1 }),
      room("waiting-3", { playerCount: 3 }),
      room("playing-2", { status: "started", playerCount: 5 }),
    ]);

    expect(scene.rooms.map(({ roomId }) => roomId)).toEqual([
      "waiting-1",
      "waiting-2",
      "playing-1",
    ]);
    expect(scene.hiddenRoomCount).toBe(2);
    expect(scene.waitingPlayerCount).toBe(6);
    expect(scene.waitingRoomCount).toBe(3);
    expect(scene.playingRoomCount).toBe(2);
  });

  it("preserves public identities and fills count-only seats anonymously", () => {
    const named = buildGamePoolLobbyScene([
      room("named", {
        playerCount: 2,
        occupants: [
          { id: "opaque-ada", label: "A" },
          { id: "opaque-bea", label: "B" },
        ],
      }),
    ]).rooms[0];
    const counted = buildGamePoolLobbyScene([room("counted", { playerCount: 3, occupants: [] })])
      .rooms[0];

    expect(named?.actors.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "opaque-ada", label: "A" },
      { id: "opaque-bea", label: "B" },
    ]);
    expect(counted?.actors).toHaveLength(3);
    expect(counted?.actors.every(({ label }) => label === undefined)).toBe(true);
    expect(new Set(counted?.actors.map(({ id }) => id)).size).toBe(3);
  });

  it("announces matching and a selected destination clearly", () => {
    const rooms = buildGamePoolLobbyScene([room("room-1", { label: "room 1" })]).rooms;

    expect(
      gamePoolLobbyStatus({
        destinationRoomId: null,
        joining: true,
        rooms,
        waitingPlayerCount: 0,
        waitingRoomCount: 0,
      }),
    ).toBe("finding you a room…");
    expect(
      gamePoolLobbyStatus({
        destinationRoomId: "room-1",
        joining: true,
        rooms,
        waitingPlayerCount: 0,
        waitingRoomCount: 0,
      }),
    ).toBe("room 1 found · heading over");
  });

  it("keeps a room-specific invitation visible in the scene", () => {
    const scene = buildGamePoolLobbyScene(
      [room("first"), room("second"), room("invited"), room("playing", { status: "started" })],
      "invited",
    );

    expect(scene.rooms.map(({ roomId }) => roomId)).toEqual(["invited", "first", "playing"]);
  });
});
