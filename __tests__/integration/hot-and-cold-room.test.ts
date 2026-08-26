import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/features/things/hot-and-cold/hot-and-cold-scorer.server", () => ({
  scoreHotAndColdGuess: vi.fn(async (_target: string, guess: string) =>
    guess === "exact" ? { rank: 0, band: "found" } : { rank: 500, band: "warm" },
  ),
}));

let roomEngine: typeof import("@/features/things/hot-and-cold/hot-and-cold-room-engine.server");

beforeAll(async () => {
  roomEngine = await import("@/features/things/hot-and-cold/hot-and-cold-room-engine.server");
});

afterEach(() => vi.unstubAllEnvs());

describe("Hot and Cold room", () => {
  it("fails closed without Redis in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(roomEngine.createHotAndColdRoom({ hostName: "Ada" })).rejects.toThrow(
      "Hot & Cold rooms require Redis",
    );
  });

  it("rotates the free opening guess between rounds", async () => {
    const host = await roomEngine.createHotAndColdRoom({
      hostName: "Ada",
      rounds: 2,
      guessesPerPlayer: 2,
      turnSeconds: 0,
    });
    const guest = await roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Bea" });
    if (!guest.ok) throw new Error("Could not join the test room");

    const started = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "game.start", actionId: "start" },
    });
    expect(started.snapshot?.round).toMatchObject({
      currentPlayerId: host.playerId,
      openingGuess: true,
    });

    const exact = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: {
        type: "guess.submit",
        actionId: "exact-first",
        roundId: started.snapshot?.round?.id ?? "",
        word: "exact",
      },
    });
    expect(exact.snapshot?.phase).toBe("reveal");
    expect(exact.snapshot?.players.find(({ id }) => id === host.playerId)?.turnsUsed).toBe(0);

    const next = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "round.next", actionId: "next" },
    });
    expect(next.snapshot?.round).toMatchObject({
      number: 2,
      currentPlayerId: guest.playerId,
      openingGuess: true,
    });
  });

  it("does not interrupt the active turn when another player gives up", async () => {
    const host = await roomEngine.createHotAndColdRoom({
      hostName: "Cy",
      rounds: 1,
      turnSeconds: 0,
    });
    const guest = await roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Dee" });
    if (!guest.ok) throw new Error("Could not join the test room");
    const started = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "game.start", actionId: "start-two" },
    });

    const result = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: guest.playerId,
      playerToken: guest.playerToken,
      action: {
        type: "round.giveUp",
        actionId: "guest-gives-up",
        roundId: started.snapshot?.round?.id ?? "",
      },
    });

    expect(result.snapshot?.round?.currentPlayerId).toBe(host.playerId);
    expect(result.snapshot?.players.find(({ id }) => id === guest.playerId)?.gaveUp).toBe(true);
  });
});
