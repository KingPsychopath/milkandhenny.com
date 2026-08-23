import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  joinPoolRoom: vi.fn(),
  postgresQuery: vi.fn(),
  publishWake: vi.fn(),
  redis: {
    del: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => fakes.redis }));
vi.mock("@/lib/platform/postgres.server", () => ({ query: fakes.postgresQuery }));
vi.mock("@/features/things/shared/multiplayer-runtime.server", () => ({
  publishMultiplayerRoomWake: fakes.publishWake,
}));
vi.mock("@/features/things/pool/game-adapters.server", () => ({
  GamePoolJoinError: class GamePoolJoinError extends Error {},
  createPoolRoomAndJoin: vi.fn(),
  gamePoolCapacity: vi.fn(() => 12),
  joinPoolRoom: fakes.joinPoolRoom,
}));
vi.mock("@/features/things/pool/membership.server", () => ({
  findGamePoolRunForClient: vi.fn(),
}));
vi.mock("@/features/things/pool/operations.server", () => ({
  recordGamePoolAllocation: vi.fn(),
}));
vi.mock("@/features/things/pool/store.server", () => ({
  createGamePoolAssignmentId: () => "gpa_test",
  getGamePoolEntranceByToken: vi.fn(async () => ({
    id: "gpe_test",
    token: "play_test-token-with-enough-characters",
    label: "same brain",
    game: "same-brain",
    preset: {
      game: "same-brain",
      rounds: 8,
      scoring: "embedding",
      sayItAloud: true,
      eliminateOddOne: false,
    },
    targetSize: 8,
    autoJoin: true,
    allowRoomChoice: false,
    allowNewRooms: true,
    nameVisibility: "initials",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    retiredAt: null,
    run: {
      id: "gpr_test",
      entranceId: "gpe_test",
      status: "open",
      preset: {
        game: "same-brain",
        rounds: 8,
        scoring: "embedding",
        sayItAloud: true,
        eliminateOddOne: false,
      },
      targetSize: 8,
      autoJoin: true,
      allowRoomChoice: false,
      allowNewRooms: true,
      nameVisibility: "initials",
      openedAt: "2026-08-23T00:00:00.000Z",
      closesAt: null,
      closedAt: null,
    },
  })),
  listGamePoolRoomRows: vi.fn(),
  withGamePoolAllocation: vi.fn(
    async (_runId: string, operation: (client: { query: typeof fakes.clientQuery }) => unknown) =>
      operation({ query: fakes.clientQuery }),
  ),
}));

import { gamePoolRoomInvitePath } from "@/features/things/pool/pool-session.client";
import { assignGamePoolRoom } from "@/features/things/pool/pool.server";

describe("game-pool room invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.postgresQuery.mockResolvedValue([]);
    fakes.publishWake.mockResolvedValue(undefined);
    fakes.redis.get.mockImplementation(async (key: string) =>
      key.includes(":assignment:") ? null : "room-join-token",
    );
    fakes.redis.set.mockResolvedValue("OK");
    fakes.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("select status, closes_at"))
        return { rows: [{ status: "open", closes_at: null, allow_new_rooms: true }] };
      if (sql.includes("select * from game_pool_rooms"))
        return {
          rows: [
            {
              run_id: "gpr_test",
              room_id: "ABCDEFG",
              status: "open",
              player_count: 2,
              capacity: 12,
              created_at: new Date("2026-08-23T00:00:00.000Z"),
              updated_at: new Date("2026-08-23T00:00:00.000Z"),
            },
          ],
        };
      return { rows: [], rowCount: 1 };
    });
    fakes.joinPoolRoom.mockResolvedValue({
      game: "same-brain",
      roomId: "ABCDEFG",
      expiresAt: Date.now() + 60_000,
      playerId: "player_test",
      playerToken: "player_token_test",
    });
  });

  it("builds a portable link to one room through its pool entrance", () => {
    expect(gamePoolRoomInvitePath("play_abc", "ABCDEFG")).toBe("/play/play_abc?room=ABCDEFG");
  });

  it("admits a targeted room invite when the public room directory is hidden", async () => {
    await expect(
      assignGamePoolRoom({
        token: "play_test-token-with-enough-characters",
        clientId: "client_test_1234",
        name: "Ada",
        choice: { roomId: "ABCDEFG" },
      }),
    ).resolves.toMatchObject({ game: "same-brain", roomId: "ABCDEFG" });

    expect(fakes.joinPoolRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "ABCDEFG",
        joinToken: "room-join-token",
        name: "Ada",
      }),
    );
  });
});
