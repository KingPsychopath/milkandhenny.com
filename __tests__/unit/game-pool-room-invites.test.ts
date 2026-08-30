import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  clearAssignmentReceipts: vi.fn(),
  createPoolRoomAndJoin: vi.fn(),
  expireStaleGamePoolAssignments: vi.fn(async () => ({
    staleAssignments: 0,
    closedRooms: 0,
    receipts: [],
  })),
  joinPoolRoom: vi.fn(),
  leavePoolRoom: vi.fn(),
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
  createPoolRoomAndJoin: fakes.createPoolRoomAndJoin,
  gamePoolCapacity: vi.fn(() => 12),
  joinPoolRoom: fakes.joinPoolRoom,
  leavePoolRoom: fakes.leavePoolRoom,
}));
vi.mock("@/features/things/pool/membership.server", () => ({
  clearAssignmentReceipts: fakes.clearAssignmentReceipts,
  expireStaleGamePoolAssignments: fakes.expireStaleGamePoolAssignments,
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
    gameSettings: {
      format: "milk-and-henny/game-settings",
      schemaVersion: 1,
      game: "same-brain",
      settings: {
        game: "same-brain",
        rounds: 8,
        sayItAloud: true,
        eliminateOddOne: false,
        revealAuthors: true,
      },
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
      gameSettings: {
        format: "milk-and-henny/game-settings",
        schemaVersion: 1,
        game: "same-brain",
        settings: {
          game: "same-brain",
          rounds: 8,
          sayItAloud: true,
          eliminateOddOne: false,
          revealAuthors: true,
        },
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
import { assignGamePoolRoom, releaseGamePoolAssignment } from "@/features/things/pool/pool.server";

describe("game-pool room invites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.postgresQuery.mockResolvedValue([]);
    fakes.publishWake.mockResolvedValue(undefined);
    fakes.redis.get.mockImplementation(async (key: string) =>
      key.includes(":assignment:") ? null : "room-join-token",
    );
    fakes.redis.set.mockResolvedValue("OK");
    fakes.leavePoolRoom.mockResolvedValue({ ok: true, accepted: true });
    fakes.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("select status, closes_at"))
        return {
          rows: [
            {
              status: "open",
              closes_at: null,
              allow_new_rooms: true,
              target_size: 8,
              preset: {
                game: "same-brain",
                rounds: 8,
                sayItAloud: true,
                eliminateOddOne: false,
                revealAuthors: true,
              },
            },
          ],
        };
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
        moveExisting: false,
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

  it("replaces an active assignment only when the caller explicitly moves", async () => {
    const calls: string[] = [];
    const previousAssignment = {
      game: "same-brain" as const,
      roomId: "OLD123",
      expiresAt: Date.now() + 60_000,
      playerId: "old_player",
      playerToken: "old_player_token",
    };
    fakes.redis.get.mockImplementation(async (key: string) =>
      key.includes(":assignment:") ? { assignment: previousAssignment } : "room-join-token",
    );
    fakes.clientQuery.mockImplementation(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("select status, closes_at"))
        return {
          rows: [
            {
              status: "open",
              closes_at: null,
              allow_new_rooms: true,
              target_size: 8,
              preset: {
                game: "same-brain",
                rounds: 8,
                sayItAloud: true,
                eliminateOddOne: false,
                revealAuthors: true,
              },
            },
          ],
        };
      if (sql.includes("status = 'active'")) return { rows: [{ room_id: "OLD123" }] };
      if (sql.includes("status = 'removed'")) return { rows: [] };
      if (sql.includes("select * from game_pool_rooms"))
        return {
          rows: [
            {
              run_id: "gpr_test",
              room_id: "NEW123",
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
      roomId: "NEW123",
      expiresAt: Date.now() + 60_000,
      playerId: "new_player",
      playerToken: "new_player_token",
    });

    await expect(
      assignGamePoolRoom({
        token: "play_test-token-with-enough-characters",
        clientId: "client_test_1234",
        name: "Ada",
        choice: { roomId: "NEW123" },
        moveExisting: true,
      }),
    ).resolves.toMatchObject({ roomId: "NEW123" });

    expect(calls.findIndex((sql) => sql.includes("set status = 'left'"))).toBeGreaterThan(-1);
    expect(fakes.joinPoolRoom).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: "NEW123", name: "Ada" }),
    );
    expect(fakes.leavePoolRoom).toHaveBeenCalledWith(previousAssignment);
  });

  it("leaves the authoritative room before releasing its pool assignment", async () => {
    const assignment = {
      game: "same-brain" as const,
      roomId: "ABCDEFG",
      expiresAt: Date.now() + 60_000,
      playerId: "player_test",
      playerToken: "player_token_test",
    };
    fakes.redis.get.mockResolvedValue({ assignment });
    fakes.clientQuery.mockImplementation(async (sql: string) =>
      sql.includes("set status = 'left'")
        ? { rows: [{ room_id: assignment.roomId }], rowCount: 1 }
        : { rows: [], rowCount: 1 },
    );

    await expect(
      releaseGamePoolAssignment({
        token: "play_test-token-with-enough-characters",
        clientId: "client_test_1234",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fakes.leavePoolRoom).toHaveBeenCalledWith(assignment);
    expect(fakes.clientQuery).toHaveBeenCalledWith(expect.stringContaining("set status = 'left'"), [
      "gpr_test",
      "client_test_1234",
    ]);
  });
});
