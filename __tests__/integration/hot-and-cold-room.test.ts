import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { subscribeOfficialResultWake } from "@/features/game-results/outbox.server";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/features/things/hot-and-cold/hot-and-cold-scorer.server", () => ({
  scoreHotAndColdGuess: vi.fn(async (_target: string, guess: string) =>
    guess === "exact"
      ? { word: guess, rank: 0, band: "found", judgingVersion: "1.0.0" }
      : { word: guess, rank: 500, band: "warm", judgingVersion: "1.0.0" },
  ),
}));

let roomEngine: typeof import("@/features/things/hot-and-cold/hot-and-cold-room-engine.server");

beforeAll(async () => {
  roomEngine = await import("@/features/things/hot-and-cold/hot-and-cold-room-engine.server");
});

afterEach(() => vi.unstubAllEnvs());

describe("Hot and Cold room", () => {
  it("lets a lobby player rename without taking another player's name", async () => {
    const host = await roomEngine.createHotAndColdRoom({ hostName: "Ada" });
    const guest = await roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Bea" });
    if (!guest.ok) throw new Error(guest.error);
    const rename = (name: string) =>
      roomEngine.applyHotAndColdAction({
        roomId: host.roomId,
        playerId: guest.playerId,
        playerToken: guest.playerToken,
        action: { type: "player.rename", name, actionId: `rename:${name}` },
      });
    for (const name of ["  ", "ADA", "x".repeat(25)]) {
      expect((await rename(name)).accepted).toBe(false);
    }
    const renamed = await rename("  Maya  ");
    expect(renamed.accepted).toBe(true);
    expect(renamed.snapshot?.players.find((player) => player.id === guest.playerId)?.name).toBe(
      "Maya",
    );
  });

  it("lets the room lead close and reopen admission", async () => {
    const host = await roomEngine.createHotAndColdRoom({ hostName: "Ada" });
    expect(host.snapshot.joinLocked).toBe(false);
    await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "room.admission.set", locked: true, actionId: "lock-room" },
    });
    await expect(
      roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Bea" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "room_locked" });
    await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "room.admission.set", locked: false, actionId: "open-room" },
    });
    await expect(
      roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Bea" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("recovers one hunter after a lost join response, even once the hunt has started", async () => {
    const host = await roomEngine.createHotAndColdRoom({ hostName: "Ada" });
    const attempt = {
      joinId: "join-hot-and-cold-recovery",
      playerToken: "hot-and-cold-client-generated-player-token",
    };
    const first = await roomEngine.joinHotAndColdRoom({
      roomId: host.roomId,
      name: "Bea",
      ...attempt,
    });
    if (!first.ok) throw new Error(first.error);

    const started = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "game.start", actionId: "start-recovery-test" },
    });
    expect(started.accepted).toBe(true);

    const recovered = await roomEngine.joinHotAndColdRoom({
      roomId: host.roomId,
      name: "Bea",
      ...attempt,
    });
    expect(recovered).toMatchObject({
      ok: true,
      playerId: first.playerId,
      playerToken: attempt.playerToken,
    });
    if (recovered.ok)
      expect(recovered.snapshot.players.filter(({ name }) => name === "Bea")).toHaveLength(1);
  });

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

  it("publishes one authoritative final result for event scoring", async () => {
    let resolveEnvelope!: (value: OfficialGameResultEnvelope) => void;
    const envelope = new Promise<OfficialGameResultEnvelope>((resolve) => {
      resolveEnvelope = resolve;
    });
    const unsubscribe = subscribeOfficialResultWake((envelopes) => {
      const result = envelopes.find(({ channelId }) => channelId === "channel-hot-cold");
      if (result) resolveEnvelope(result);
    });
    try {
      const host = await roomEngine.createHotAndColdRoom({
        hostName: "Ada",
        rounds: 1,
        turnSeconds: 0,
        officialResultChannelId: "channel-hot-cold",
      });
      const guest = await roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Bea" });
      if (!guest.ok) throw new Error("Could not join the test room");
      const started = await roomEngine.applyHotAndColdAction({
        roomId: host.roomId,
        playerId: host.playerId,
        playerToken: host.playerToken,
        action: { type: "game.start", actionId: "official-start" },
      });
      const exact = await roomEngine.applyHotAndColdAction({
        roomId: host.roomId,
        playerId: host.playerId,
        playerToken: host.playerToken,
        action: {
          type: "guess.submit",
          actionId: "official-exact",
          roundId: started.snapshot?.round?.id ?? "",
          word: "exact",
        },
      });
      await roomEngine.applyHotAndColdAction({
        roomId: host.roomId,
        playerId: host.playerId,
        playerToken: host.playerToken,
        action: { type: "round.next", actionId: "official-finish" },
      });

      await expect(envelope).resolves.toMatchObject({
        channelId: "channel-hot-cold",
        gameKind: "hot-and-cold",
        gameInstanceId: host.roomId,
        resultId: "game:1",
        players: expect.arrayContaining([
          expect.objectContaining({ playerId: host.playerId, outcome: "completed", placement: 1 }),
          expect.objectContaining({ playerId: guest.playerId, outcome: "completed", placement: 2 }),
        ]),
      });
      expect(exact.snapshot?.phase).toBe("reveal");
    } finally {
      await unsubscribe();
    }
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

  it("starts without only the explicitly confirmed absent players", async () => {
    const host = await roomEngine.createHotAndColdRoom({ hostName: "Eli" });
    const readyGuest = await roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Flo" });
    const absent = await roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Gia" });
    if (!readyGuest.ok || !absent.ok) throw new Error("Could not join the test room");
    await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: absent.playerId,
      playerToken: absent.playerToken,
      action: { type: "readiness.set", actionId: "absent", ready: false },
    });
    await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "game.start", actionId: "nudge-absent" },
    });

    const started = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: {
        type: "game.start",
        actionId: "remove-absent",
        removePlayerIds: [absent.playerId],
      },
    });

    expect(started).toMatchObject({ ok: true, accepted: true });
    expect(started.snapshot?.players.some(({ id }) => id === absent.playerId)).toBe(false);
  });

  it("keeps the lobby intact when removing an absent player would go below the minimum", async () => {
    const host = await roomEngine.createHotAndColdRoom({ hostName: "Hal" });
    const absent = await roomEngine.joinHotAndColdRoom({ roomId: host.roomId, name: "Ivy" });
    if (!absent.ok) throw new Error("Could not join the test room");
    await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: absent.playerId,
      playerToken: absent.playerToken,
      action: { type: "readiness.set", actionId: "absent-two", ready: false },
    });
    await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: { type: "game.start", actionId: "nudge-two" },
    });
    const rejected = await roomEngine.applyHotAndColdAction({
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      action: {
        type: "game.start",
        actionId: "remove-two",
        removePlayerIds: [absent.playerId],
      },
    });

    expect(rejected).toMatchObject({ ok: true, accepted: false });
    expect(rejected.snapshot).toMatchObject({ phase: "lobby" });
    expect(rejected.snapshot?.players).toHaveLength(2);
  });
});
