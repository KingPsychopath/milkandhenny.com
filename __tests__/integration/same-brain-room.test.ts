import { afterEach, describe, expect, it, vi } from "vitest";

const deliveredResults = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/game-results/outbox.server", () => ({
  publishOfficialResultsAfterCommit: vi.fn((queued: Array<{ envelope: Record<string, unknown> }>) =>
    deliveredResults.push(...queued.map(({ envelope }) => envelope)),
  ),
  persistRoomWithOfficialResults: vi.fn(),
  sealOfficialGameResult: vi.fn(
    (input: { channelId: string; revision: number; result: Record<string, unknown> }) => ({
      ...input.result,
      schemaVersion: 1,
      channelId: input.channelId,
      revision: input.revision,
      operation: "record",
      committedAt: "2026-08-08T12:00:00.000Z",
      payloadHash: "d".repeat(64),
    }),
  ),
}));

import {
  applySameBrainHostAction,
  applySameBrainPlayerAction,
  createSameBrainRoom,
  joinSameBrainRoom,
  readSameBrainSnapshot,
} from "../../features/things/same-brain/same-brain-room.server";
import { startSameBrainScenario } from "../../features/things/same-brain/same-brain-room-engine.server";
import { SAME_BRAIN_SCENARIOS } from "../../features/things/same-brain/same-brain-scenarios";
import type { SameBrainSnapshot } from "../../features/things/same-brain/types";

afterEach(() => {
  deliveredResults.length = 0;
  vi.useRealTimers();
});

let actionCounter = 0;
const nextActionId = () => `action-${(actionCounter += 1)}`;

interface Seat {
  playerId: string;
  playerToken: string;
  name: string;
}

/**
 * The spoken beat is off unless a test asks for it.
 *
 * It sits between answer locking and the reveal, so leaving it on would make every scoring assertion go
 * through a seven-second countdown it is not about. The beat has its own describe block; everything
 * here is about who scores.
 */
async function room(
  names: string[],
  options: {
    rounds?: number;
    toggles?: Record<string, boolean>;
    officialResultChannelId?: string;
  } = {},
) {
  const created = await createSameBrainRoom({
    rounds: options.rounds,
    toggles: { sayItAloud: false, ...options.toggles },
    officialResultChannelId: options.officialResultChannelId,
  });
  const seats: Seat[] = [];
  for (const name of names) {
    const joined = await joinSameBrainRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name,
      joinId: `${created.roomId}-${name}`,
    });
    if (!joined.ok) throw new Error(`could not seat ${name}: ${joined.error}`);
    seats.push({ playerId: joined.playerId, playerToken: joined.playerToken, name });
  }
  return { ...created, seats };
}

const read = async (roomId: string, seat: Seat) => {
  const result = await readSameBrainSnapshot({
    roomId,
    credential: seat.playerToken,
    playerId: seat.playerId,
    lastSequence: 0,
  });
  if (!result.ok) throw new Error(result.error);
  // The helper never sends a digest, so a body is guaranteed. Narrowed once here rather than at
  // every call site.
  if (result.unchanged) throw new Error("unexpected unchanged read");
  return result.snapshot;
};

const host = (roomId: string, hostToken: string, action: Record<string, unknown>) =>
  applySameBrainHostAction({
    roomId,
    hostToken,
    action: { actionId: nextActionId(), ...action } as never,
  });

const act = (roomId: string, seat: Seat, action: Record<string, unknown>) =>
  applySameBrainPlayerAction({
    roomId,
    playerId: seat.playerId,
    playerToken: seat.playerToken,
    action: { actionId: nextActionId(), ...action } as never,
  });

/** Starts the game and walks past the prompt beat, which is a fixed countdown with nothing to do. */
async function begin(created: Awaited<ReturnType<typeof room>>) {
  await host(created.roomId, created.hostToken, { type: "game.start" });
  await host(created.roomId, created.hostToken, { type: "phase.advance" });
  return read(created.roomId, created.seats[0]);
}

async function answerAll(
  created: Awaited<ReturnType<typeof room>>,
  round: number,
  texts: Array<string | null>,
) {
  for (const [index, text] of texts.entries()) {
    if (text === null) continue;
    await act(created.roomId, created.seats[index], { type: "answer.submit", round, text });
  }
}

describe("same brain room", () => {
  it("lets the room creator close and reopen admission", async () => {
    const created = await createSameBrainRoom({});
    const locked = await host(created.roomId, created.hostToken, {
      type: "room.admission.set",
      locked: true,
    });
    expect(locked).toMatchObject({ accepted: true, snapshot: { joinLocked: true } });
    await expect(
      joinSameBrainRoom({
        roomId: created.roomId,
        joinToken: created.joinToken,
        name: "Maya",
        joinId: `${created.roomId}-locked`,
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "room_locked" });
    await host(created.roomId, created.hostToken, { type: "room.admission.set", locked: false });
    await expect(
      joinSameBrainRoom({
        roomId: created.roomId,
        joinToken: created.joinToken,
        name: "Maya",
        joinId: `${created.roomId}-open`,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("recovers a joined player after the game starts when the first response was lost", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await host(created.roomId, created.hostToken, { type: "game.start" });

    const recovered = await joinSameBrainRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "Maya",
      joinId: `${created.roomId}-Maya`,
    });
    expect(recovered).toMatchObject({
      ok: true,
      playerId: created.seats[1].playerId,
      playerToken: created.seats[1].playerToken,
    });
    if (recovered.ok)
      expect(recovered.snapshot.players.filter(({ name }) => name === "Maya")).toHaveLength(1);
  });

  it("seats a table and makes the first joiner host", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.phase).toBe("lobby");
    expect(snapshot.players).toHaveLength(3);
    expect(snapshot.hostPlayerId).toBe(created.seats[0].playerId);
    expect(snapshot.question).toBeNull();
  });

  it("refuses a fourth name that is already in the room", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    const clash = await joinSameBrainRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "abel",
      joinId: "another-device",
    });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.errorCode).toBe("name_taken");
  });

  it("will not start below the minimum table", async () => {
    const created = await room(["Abel", "Maya"]);
    const result = await host(created.roomId, created.hostToken, { type: "game.start" });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.errorCode).toBe("not_enough_players");
  });

  it("gives everyone the same question and hides other people's answers", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    const [first, second] = await Promise.all([
      read(created.roomId, created.seats[0]),
      read(created.roomId, created.seats[1]),
    ]);
    expect(first.question).toBe(second.question);
    expect(first.phase).toBe("submit");

    await act(created.roomId, created.seats[0], {
      type: "answer.submit",
      round: 1,
      text: "spoon",
    });
    const others = await read(created.roomId, created.seats[1]);
    // Maya can see that Abel has answered, and nothing about what he said.
    expect(others.players.find(({ id }) => id === created.seats[0].playerId)?.answered).toBe(true);
    expect(others.you?.answer).toBeNull();
    expect(JSON.stringify(others)).not.toContain("spoon");
    expect(others.result).toBeNull();
  });

  it("echoes your own answer back so a reconnect does not lose it", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await act(created.roomId, created.seats[0], { type: "answer.submit", round: 1, text: "spoon" });
    expect((await read(created.roomId, created.seats[0])).you?.answer).toBe("spoon");
  });

  it("scores the round as soon as the last answer lands", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await answerAll(created, 1, ["spoon", "spoon", "fork"]);

    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.phase).toBe("reveal");
    expect(snapshot.result?.pointsEach).toBe(2);
    expect(snapshot.players.find(({ name }) => name === "Abel")?.score).toBe(2);
    expect(snapshot.players.find(({ name }) => name === "Daniel")?.score).toBe(0);
  });

  it("answers the last submitter with the reveal rather than a dead submit screen", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await answerAll(created, 1, ["spoon", "spoon"]);
    const last = await act(created.roomId, created.seats[2], {
      type: "answer.submit",
      round: 1,
      text: "fork",
    });
    expect(last.accepted).toBe(true);
    if (last.accepted) expect(last.snapshot.phase).toBe("reveal");
  });

  it("names the odd one out but does not remove them by default", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await answerAll(created, 1, ["ice", "ice", "breakup"]);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.result?.oddPlayerId).toBe(created.seats[2].playerId);
    expect(snapshot.players.find(({ name }) => name === "Daniel")?.out).toBe(false);
    expect(snapshot.players.find(({ name }) => name === "Daniel")?.aloneCount).toBe(1);
  });

  it("removes the odd one out under the house rule, and stops them answering", async () => {
    const created = await room(["Abel", "Maya", "Daniel", "Priya"], {
      toggles: { eliminateOddOne: true },
    });
    await begin(created);
    await answerAll(created, 1, ["ice", "ice", "ice", "breakup"]);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.players.find(({ name }) => name === "Priya")?.out).toBe(true);

    await host(created.roomId, created.hostToken, { type: "phase.advance" });
    await host(created.roomId, created.hostToken, { type: "phase.advance" });
    const blocked = await act(created.roomId, created.seats[3], {
      type: "answer.submit",
      round: 2,
      text: "anything",
    });
    expect(blocked.accepted).toBe(false);
    if (!blocked.accepted) expect(blocked.errorCode).toBe("out_of_game");
  });

  it("pays a unanimous room half, so the obvious answer is the cheap one", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await answerAll(created, 1, ["hammer", "hammer", "hammer"]);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.result?.pointsEach).toBe(1);
    expect(snapshot.players.every(({ score }) => score === 1)).toBe(true);
  });

  it("scores nobody when the room splits evenly", async () => {
    const created = await room(["Abel", "Maya", "Daniel", "Priya"]);
    await begin(created);
    await answerAll(created, 1, ["pineapple", "pineapple", "anchovy", "anchovy"]);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.result?.herdIndex).toBeNull();
    expect(snapshot.result?.noScoreReason).toBe("split");
    expect(snapshot.players.every(({ score }) => score === 0)).toBe(true);
  });

  it("normalises harmless differences but leaves different words for the room", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await answerAll(created, 1, ["the sea", "ocean", "canal"]);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.result?.herdIndex).toBeNull();
    expect(snapshot.result?.clusters.find(({ label }) => label === "sea")?.playerIds).toEqual([
      expect.any(String),
    ]);
    expect(snapshot.result?.answers.map(({ text }) => text)).toEqual(["the sea", "ocean", "canal"]);
  });

  it("scores on whoever answered when a submit times out", async () => {
    vi.useFakeTimers();
    const created = await room(["Abel", "Maya", "Daniel", "Priya"]);
    await begin(created);
    await answerAll(created, 1, ["traffic", "traffic", "traffic", null]);
    // Priya's phone is face down. The clock runs out.
    vi.advanceTimersByTime(200_000);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.phase).toBe("reveal");
    expect(snapshot.result?.answers).toHaveLength(3);
    expect(snapshot.players.find(({ name }) => name === "Abel")?.score).toBe(2);
    expect(snapshot.players.find(({ name }) => name === "Priya")?.score).toBe(0);
  });

  it("lets a player change an answer before the round closes", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await act(created.roomId, created.seats[0], { type: "answer.submit", round: 1, text: "spoon" });
    await act(created.roomId, created.seats[0], { type: "answer.clear", round: 1 });
    expect((await read(created.roomId, created.seats[0])).you?.answer).toBeNull();
    await act(created.roomId, created.seats[0], { type: "answer.submit", round: 1, text: "fork" });
    await answerAll(created, 1, [null, "fork", "knife"]);
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.result?.clusters.find(({ label }) => label === "fork")?.playerIds).toHaveLength(
      2,
    );
  });

  it("refuses an answer for a round that has closed", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await answerAll(created, 1, ["spoon", "spoon", "fork"]);
    const late = await act(created.roomId, created.seats[0], {
      type: "answer.submit",
      round: 1,
      text: "changed my mind",
    });
    expect(late.accepted).toBe(false);
    if (!late.accepted) expect(late.errorCode).toBe("phase_ended");
  });

  it("refuses an empty answer", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    const result = await act(created.roomId, created.seats[0], {
      type: "answer.submit",
      round: 1,
      text: "  !!  ",
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.errorCode).toBe("invalid_answer");
  });

  /** A retried request must not score a player twice. */
  it("treats a repeated action id as already done", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    const actionId = "retried-once";
    for (let attempt = 0; attempt < 3; attempt += 1)
      await applySameBrainPlayerAction({
        roomId: created.roomId,
        playerId: created.seats[0].playerId,
        playerToken: created.seats[0].playerToken,
        action: { actionId, type: "answer.submit", round: 1, text: "spoon" },
      });
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.you?.answer).toBe("spoon");
    expect(snapshot.players.filter(({ answered }) => answered)).toHaveLength(1);
  });

  it("rejects a stolen player token", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    const result = await applySameBrainPlayerAction({
      roomId: created.roomId,
      playerId: created.seats[0].playerId,
      playerToken: "not-the-token",
      action: { actionId: nextActionId(), type: "readiness.set", ready: false },
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) expect(result.errorCode).toBe("room_unavailable");
  });

  it("refuses to join once the game has started", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    const late = await joinSameBrainRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "Latecomer",
      joinId: "late",
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errorCode).toBe("game_started");
  });

  it("starts without only the explicitly confirmed absent players", async () => {
    const created = await room(["Abel", "Maya", "Daniel", "Priya"]);
    const absent = created.seats[3];
    await act(created.roomId, absent, { type: "readiness.set", ready: false });
    const blocked = await host(created.roomId, created.hostToken, { type: "game.start" });
    expect(blocked.accepted).toBe(false);

    const started = await host(created.roomId, created.hostToken, {
      type: "game.start",
      removePlayerIds: [absent.playerId],
    });
    expect(started.accepted).toBe(true);
    expect(started.snapshot?.phase).toBe("prompt");
    expect(started.snapshot?.players.some(({ id }) => id === absent.playerId)).toBe(false);
  });

  it("does not remove anyone when too few ready players would remain", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    const absent = created.seats[2];
    await act(created.roomId, absent, { type: "readiness.set", ready: false });
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const rejected = await host(created.roomId, created.hostToken, {
      type: "game.start",
      removePlayerIds: [absent.playerId],
    });
    expect(rejected.accepted).toBe(false);
    if (!rejected.accepted) expect(rejected.errorCode).toBe("not_enough_players");
    const unchanged = await read(created.roomId, created.seats[0]);
    expect(unchanged.phase).toBe("lobby");
    expect(unchanged.players).toHaveLength(3);
  });

  /**
   * Two waits, not one. The room can only start the clock on a missing host once a poll has noticed
   * they are missing, so the claim window opens a minute after that observation rather than a minute
   * after they actually went quiet — otherwise a host who dropped for one poll could be deposed.
   */
  it("hands the host seat over when the host has been gone long enough", async () => {
    vi.useFakeTimers();
    const created = await room(["Abel", "Maya", "Daniel"]);
    // Maya keeps polling; Abel's phone is gone.
    vi.advanceTimersByTime(90_000);
    await read(created.roomId, created.seats[1]);
    const tooSoon = await act(created.roomId, created.seats[1], { type: "host.claim" });
    expect(tooSoon.accepted).toBe(false);

    vi.advanceTimersByTime(90_000);
    await read(created.roomId, created.seats[1]);
    const claim = await act(created.roomId, created.seats[1], { type: "host.claim" });
    expect(claim.accepted).toBe(true);
    expect((await read(created.roomId, created.seats[1])).hostPlayerId).toBe(
      created.seats[1].playerId,
    );
  });

  it("does not hand the host seat over while the host is still there", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    const claim = await act(created.roomId, created.seats[1], { type: "host.claim" });
    expect(claim.accepted).toBe(false);
  });

  it("plays a whole game through to a winner", async () => {
    const created = await room(["Abel", "Maya", "Daniel"], {
      rounds: 3,
      officialResultChannelId: "gsc_same_brain",
    });
    await host(created.roomId, created.hostToken, { type: "game.start" });

    for (let round = 1; round <= 3; round += 1) {
      await host(created.roomId, created.hostToken, { type: "phase.advance" });
      await answerAll(created, round, ["yes", "yes", "no"]);
      const mid = await read(created.roomId, created.seats[0]);
      expect(mid.phase).toBe(round === 3 ? "reveal" : "reveal");
      if (round < 3) await host(created.roomId, created.hostToken, { type: "phase.advance" });
    }
    await host(created.roomId, created.hostToken, { type: "phase.advance" });

    const ending = await read(created.roomId, created.seats[0]);
    expect(ending.phase).toBe("ending");
    expect(ending.history).toHaveLength(3);
    expect(ending.winnerIds).toEqual(
      expect.arrayContaining([created.seats[0].playerId, created.seats[1].playerId]),
    );
    expect(ending.players.find(({ name }) => name === "Abel")?.score).toBe(6);
    expect(deliveredResults).toHaveLength(1);
    expect(deliveredResults[0]).toMatchObject({
      channelId: "gsc_same_brain",
      gameKind: "same-brain",
      gameInstanceId: created.roomId,
      resultId: "game:1",
      scope: "game",
    });
    expect(JSON.stringify(deliveredResults[0])).not.toContain("Abel");
  });

  /**
   * The beat where the room says the answers out loud.
   *
   * Two properties make it worth having and both are tested here: the round is already decided when
   * it starts, so speaking cannot change the outcome; and nobody else's word is in the snapshot yet,
   * so the room genuinely hears them simultaneously rather than reading them off a screen. If the
   * second one ever broke, the beat would become a way to hear an answer and then adjust.
   */
  describe("saying it out loud", () => {
    const spokenRoom = async (names = ["Abel", "Maya", "Daniel"]) => {
      const created = await room(names, { toggles: { sayItAloud: true } });
      await begin(created);
      return created;
    };

    it("holds a beat between the answers landing and the result", async () => {
      const created = await spokenRoom();
      await answerAll(created, 1, ["spoon", "spoon", "fork"]);
      const snapshot = await read(created.roomId, created.seats[0]);
      expect(snapshot.phase).toBe("sayIt");
      expect(snapshot.question).toBeTruthy();
      // Your own word, to read out.
      expect(snapshot.you?.answer).toBe("spoon");
    });

    /** The property the whole beat rests on. */
    it("shows nobody else's word during the beat", async () => {
      const created = await spokenRoom();
      await answerAll(created, 1, ["aardvark", "aardvark", "zeppelin"]);
      const asDaniel = await read(created.roomId, created.seats[2]);
      expect(asDaniel.phase).toBe("sayIt");
      expect(asDaniel.you?.answer).toBe("zeppelin");
      // Daniel must not be able to see that the other two said aardvark.
      expect(JSON.stringify(asDaniel)).not.toContain("aardvark");
      expect(asDaniel.result).toBeNull();
    });

    it("has already scored the round before anybody speaks", async () => {
      const created = await spokenRoom();
      await answerAll(created, 1, ["spoon", "spoon", "fork"]);
      const duringBeat = await read(created.roomId, created.seats[0]);
      expect(duringBeat.phase).toBe("sayIt");
      // Points are on the board; the beat is theatre over a settled result.
      expect(duringBeat.players.find(({ name }) => name === "Abel")?.score).toBe(2);
    });

    it("moves on to the reveal when the beat runs out", async () => {
      vi.useFakeTimers();
      const created = await spokenRoom();
      await answerAll(created, 1, ["spoon", "spoon", "fork"]);
      expect((await read(created.roomId, created.seats[0])).phase).toBe("sayIt");
      vi.advanceTimersByTime(30_000);
      const after = await read(created.roomId, created.seats[0]);
      expect(after.phase).toBe("reveal");
      expect(after.result?.pointsEach).toBe(2);
      // Scored once, not once per phase.
      expect(after.players.find(({ name }) => name === "Abel")?.score).toBe(2);
    });

    it("lets the host cut the beat short", async () => {
      const created = await spokenRoom();
      await answerAll(created, 1, ["spoon", "spoon", "fork"]);
      await host(created.roomId, created.hostToken, { type: "phase.advance" });
      expect((await read(created.roomId, created.seats[0])).phase).toBe("reveal");
    });

    it("skips the beat when nobody answered", async () => {
      vi.useFakeTimers();
      const created = await spokenRoom();
      // Nothing to say, so a countdown would be seven seconds of nobody speaking.
      vi.advanceTimersByTime(200_000);
      const after = await read(created.roomId, created.seats[0]);
      expect(after.phase).toBe("reveal");
    });

    it("goes straight to the reveal with the toggle off", async () => {
      const created = await room(["Abel", "Maya", "Daniel"], { toggles: { sayItAloud: false } });
      await begin(created);
      await answerAll(created, 1, ["spoon", "spoon", "fork"]);
      expect((await read(created.roomId, created.seats[0])).phase).toBe("reveal");
    });

    /**
     * Every phone draws this countdown from `phaseEndsAt` itself, which is what keeps them in step.
     * Pausing would move that target underneath them, so the beat is the one phase that refuses.
     */
    it("refuses to pause mid-beat, which would desync the phones", async () => {
      const created = await spokenRoom();
      await answerAll(created, 1, ["spoon", "spoon", "fork"]);
      expect((await read(created.roomId, created.seats[0])).phase).toBe("sayIt");
      const paused = await host(created.roomId, created.hostToken, { type: "phase.pause" });
      expect(paused.accepted).toBe(false);
      expect((await read(created.roomId, created.seats[0])).paused).toBe(false);
    });
  });

  /**
   * The host grouping a typo after the reveal. The arithmetic has to be exact — a correction that
   * leaked a point would quietly corrupt the whole game.
   */
  describe("host corrections", () => {
    const typoRoom = async () => {
      const created = await room(["Abel", "Maya", "Daniel", "Priya"]);
      await begin(created);
      // Daniel fat-fingered it. Nothing automatic will ever join "buttter" to "butter".
      await answerAll(created, 1, ["butter", "butter", "buttter", "jam"]);
      return created;
    };

    it("folds a mistyped answer into the herd and re-scores", async () => {
      const created = await typoRoom();
      const before = await read(created.roomId, created.seats[0]);
      expect(
        before.result?.clusters.find(({ label }) => label === "butter")?.playerIds,
      ).toHaveLength(2);
      expect(before.players.find(({ name }) => name === "Daniel")?.score).toBe(0);

      const butter = before.result?.clusters.findIndex(({ label }) => label === "butter") as number;
      const typo = before.result?.clusters.findIndex(({ label }) => label === "buttter") as number;
      const merged = await host(created.roomId, created.hostToken, {
        type: "result.merge",
        round: 1,
        from: typo,
        to: butter,
      });
      expect(merged.accepted).toBe(true);

      const after = await read(created.roomId, created.seats[0]);
      expect(after.result?.corrected).toBe(true);
      expect(
        after.result?.clusters.find(({ label }) => label === "butter")?.playerIds,
      ).toHaveLength(3);
      expect(after.players.find(({ name }) => name === "Daniel")?.score).toBe(2);
      // Everybody who was already in the room keeps exactly what they had — no double award.
      expect(after.players.find(({ name }) => name === "Abel")?.score).toBe(2);
      expect(after.players.find(({ name }) => name === "Priya")?.score).toBe(0);
      // Priya is now alone against a herd of three, which she was not before.
      expect(after.result?.oddPlayerId).toBe(created.seats[3].playerId);
    });

    it("puts the round back exactly as it was", async () => {
      const created = await typoRoom();
      const before = await read(created.roomId, created.seats[0]);
      const butter = before.result?.clusters.findIndex(({ label }) => label === "butter") as number;
      const typo = before.result?.clusters.findIndex(({ label }) => label === "buttter") as number;

      await host(created.roomId, created.hostToken, {
        type: "result.merge",
        round: 1,
        from: typo,
        to: butter,
      });
      await host(created.roomId, created.hostToken, { type: "result.reset", round: 1 });

      const after = await read(created.roomId, created.seats[0]);
      expect(after.result?.corrected).toBeFalsy();
      expect(after.players.map(({ name, score }) => `${name}:${score}`)).toEqual(
        before.players.map(({ name, score }) => `${name}:${score}`),
      );
      expect(after.result?.clusters).toHaveLength(before.result?.clusters.length as number);
      expect(after.result?.oddPlayerId).toBe(before.result?.oddPlayerId);
    });

    it("re-scores a merge that makes the round unanimous, at the lower rate", async () => {
      const created = await room(["Abel", "Maya", "Daniel"]);
      await begin(created);
      await answerAll(created, 1, ["butter", "butter", "buttter"]);
      const before = await read(created.roomId, created.seats[0]);
      expect(before.result?.pointsEach).toBe(2);

      const butter = before.result?.clusters.findIndex(({ label }) => label === "butter") as number;
      const typo = before.result?.clusters.findIndex(({ label }) => label === "buttter") as number;
      await host(created.roomId, created.hostToken, {
        type: "result.merge",
        round: 1,
        from: typo,
        to: butter,
      });

      const after = await read(created.roomId, created.seats[0]);
      // One group, everybody in it: the bland rate, arrived at by correction rather than by typing.
      expect(after.result?.pointsEach).toBe(1);
      expect(after.players.every(({ score }) => score === 1)).toBe(true);
      expect(after.result?.oddPlayerId).toBeNull();
    });

    it("undoes an elimination when the correction removes the odd one", async () => {
      const created = await room(["Abel", "Maya", "Daniel", "Priya"], {
        toggles: { eliminateOddOne: true },
      });
      await begin(created);
      await answerAll(created, 1, ["butter", "butter", "butter", "buttter"]);
      const before = await read(created.roomId, created.seats[0]);
      expect(before.players.find(({ name }) => name === "Priya")?.out).toBe(true);

      const butter = before.result?.clusters.findIndex(({ label }) => label === "butter") as number;
      const typo = before.result?.clusters.findIndex(({ label }) => label === "buttter") as number;
      await host(created.roomId, created.hostToken, {
        type: "result.merge",
        round: 1,
        from: typo,
        to: butter,
      });

      const after = await read(created.roomId, created.seats[0]);
      expect(after.players.find(({ name }) => name === "Priya")?.out).toBe(false);
      expect(after.players.find(({ name }) => name === "Priya")?.aloneCount).toBe(0);
    });

    it("resolves a two-and-two split into a herd", async () => {
      const created = await room(["Abel", "Maya", "Daniel", "Priya"]);
      await begin(created);
      await answerAll(created, 1, ["sofa", "sofa", "settee", "settee"]);
      const before = await read(created.roomId, created.seats[0]);
      expect(before.result?.herdIndex).toBeNull();

      await host(created.roomId, created.hostToken, {
        type: "result.merge",
        round: 1,
        from: 1,
        to: 0,
      });
      const after = await read(created.roomId, created.seats[0]);
      expect(after.result?.herdIndex).not.toBeNull();
      expect(after.players.every(({ score }) => score === 1)).toBe(true);
    });

    it("refuses a correction outside the reveal, or with nonsense indices", async () => {
      const created = await room(["Abel", "Maya", "Daniel"]);
      await begin(created);
      const early = await host(created.roomId, created.hostToken, {
        type: "result.merge",
        round: 1,
        from: 0,
        to: 1,
      });
      expect(early.accepted).toBe(false);

      await answerAll(created, 1, ["butter", "butter", "jam"]);
      for (const [from, to] of [
        [0, 0],
        [9, 0],
        [0, 9],
      ]) {
        const bad = await host(created.roomId, created.hostToken, {
          type: "result.merge",
          round: 1,
          from,
          to,
        });
        expect(bad.accepted, `${from}->${to}`).toBe(false);
      }
    });

    it("does not let a correction land on a round that has moved on", async () => {
      const created = await room(["Abel", "Maya", "Daniel"]);
      await begin(created);
      await answerAll(created, 1, ["butter", "butter", "jam"]);
      await host(created.roomId, created.hostToken, { type: "phase.advance" });
      const stale = await host(created.roomId, created.hostToken, {
        type: "result.merge",
        round: 1,
        from: 1,
        to: 0,
      });
      expect(stale.accepted).toBe(false);
    });
  });

  /**
   * The bug this guards is silent: pausing freezes `advance`, but `phaseEndsAt` is an absolute
   * moment, so without pushing it forward on resume the round expires the instant play restarts —
   * and the host would be the one who broke it.
   */
  it("holds the clock while paused and gives the time back on resume", async () => {
    vi.useFakeTimers();
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    const running = await read(created.roomId, created.seats[0]);
    expect(running.phase).toBe("submit");
    const endsAt = running.phaseEndsAt;

    await host(created.roomId, created.hostToken, { type: "phase.pause" });
    expect((await read(created.roomId, created.seats[0])).paused).toBe(true);

    // Long enough that an unpaused room would have closed submit and scored.
    vi.advanceTimersByTime(120_000);
    const frozen = await read(created.roomId, created.seats[0]);
    expect(frozen.phase).toBe("submit");
    expect(frozen.phaseEndsAt).toBe(endsAt);

    await host(created.roomId, created.hostToken, { type: "phase.resume" });
    const resumed = await read(created.roomId, created.seats[0]);
    expect(resumed.paused).toBe(false);
    expect(resumed.phase).toBe("submit");
    // The whole paused stretch is handed back, not swallowed.
    expect(resumed.phaseEndsAt).toBeGreaterThanOrEqual(endsAt + 120_000);
  });

  it("still accepts answers while paused, and refuses a double pause", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    await begin(created);
    await host(created.roomId, created.hostToken, { type: "phase.pause" });

    const again = await host(created.roomId, created.hostToken, { type: "phase.pause" });
    expect(again.accepted).toBe(false);

    // A pause is for the room's attention, not a lock on the game.
    const answered = await act(created.roomId, created.seats[0], {
      type: "answer.submit",
      round: 1,
      text: "spoon",
    });
    expect(answered.accepted).toBe(true);
  });

  it("refuses to pause the lobby", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    const result = await host(created.roomId, created.hostToken, { type: "phase.pause" });
    expect(result.accepted).toBe(false);
  });

  it("does not spend a round on a skipped question", async () => {
    const created = await room(["Abel", "Maya", "Daniel"]);
    const started = await begin(created);
    await host(created.roomId, created.hostToken, { type: "game.skipQuestion" });
    const after = await read(created.roomId, created.seats[0]);
    expect(after.round).toBe(started.round);
    expect(after.question).not.toBe(started.question);
  });

  it("resets scores and answers when the table plays again", async () => {
    const created = await room(["Abel", "Maya", "Daniel"], { rounds: 3 });
    await begin(created);
    await answerAll(created, 1, ["yes", "yes", "no"]);
    await host(created.roomId, created.hostToken, { type: "game.replay" });
    const snapshot = await read(created.roomId, created.seats[0]);
    expect(snapshot.round).toBe(1);
    expect(snapshot.players.every(({ score }) => score === 0)).toBe(true);
    expect(snapshot.you?.answer).toBeNull();
    expect(snapshot.history).toHaveLength(0);
  });
});

/**
 * Every scenario the harness offers, opened the way the harness opens it.
 *
 * This is the part that keeps the two honest. A scenario whose `expect` line stops being true is
 * either a rules regression or a stale description, and both are worth failing a build over.
 */
describe("same brain scenarios", () => {
  const scenarioOf = (id: string) => {
    const scenario = SAME_BRAIN_SCENARIOS.find((entry) => entry.id === id);
    if (!scenario) throw new Error(`no scenario ${id}`);
    return scenario;
  };

  const openScenario = async (id: string) => {
    const scenario = scenarioOf(id);
    const started = await startSameBrainScenario({
      names: ["Abel", "Maya", "Daniel", "Priya", "Tom", "Ana"].slice(0, scenario.players),
      toggles: scenario.toggles,
      question: scenario.question,
      answers: scenario.answers,
    });
    if (started.error) throw new Error(started.error);
    const snapshot = await readSameBrainSnapshot({
      roomId: started.roomId,
      credential: started.seats[0].playerToken,
      playerId: started.seats[0].playerId,
      lastSequence: 0,
    });
    if (!snapshot.ok) throw new Error(snapshot.error);
    return { started, snapshot: snapshot.snapshot as SameBrainSnapshot };
  };

  /**
   * A scenario is opened to look at a scored round, so it must still be showing that round when it
   * renders.
   */
  it("holds the reveal open long enough to look at, whatever timings were asked for", async () => {
    const started = await startSameBrainScenario({
      names: ["Abel", "Maya", "Daniel"],
      question: "Name something in a toolbox",
      answers: { 0: "hammer", 1: "hammer", 2: "spanner" },
      // What the harness sends with "short phases" ticked.
      timings: { prompt: 2_000, submit: 15_000, reveal: 8_000 },
    });
    expect(started.error).toBeNull();
    const snapshot = await readSameBrainSnapshot({
      roomId: started.roomId,
      credential: started.seats[0].playerToken,
      playerId: started.seats[0].playerId,
      lastSequence: 0,
    });
    if (!snapshot.ok) throw new Error(snapshot.error);
    // No digest was sent, so a body is guaranteed; this narrows it for the compiler.
    if (snapshot.unchanged) throw new Error("unexpected unchanged read");
    expect(snapshot.snapshot.phase).toBe("reveal");
    expect(snapshot.snapshot.round).toBe(1);
    expect(snapshot.snapshot.result?.question).toBe("Name something in a toolbox");
    expect(snapshot.snapshot.phaseEndsAt - snapshot.snapshot.phaseStartedAt).toBeGreaterThanOrEqual(
      100_000,
    );
  });

  it("every scenario opens without error", async () => {
    for (const scenario of SAME_BRAIN_SCENARIOS) {
      const started = await startSameBrainScenario({
        names: ["Abel", "Maya", "Daniel", "Priya", "Tom", "Ana"].slice(0, scenario.players),
        toggles: scenario.toggles,
        question: scenario.question,
        answers: scenario.answers,
      });
      expect(started.error, scenario.id).toBeNull();
      expect(started.seats, scenario.id).toHaveLength(scenario.players);
    }
  });

  it("clean-majority: the spoon group scores two each and nobody is odd", async () => {
    const { snapshot } = await openScenario("clean-majority");
    expect(snapshot.result?.pointsEach).toBe(2);
    expect(snapshot.result?.clusters[snapshot.result.herdIndex as number].label).toBe("spoon");
    expect(snapshot.result?.oddPlayerId).toBeNull();
  });

  it("odd-one-out: five agree and the sixth is named", async () => {
    const { snapshot } = await openScenario("odd-one-out");
    expect(snapshot.result?.oddPlayerId).toBeTruthy();
    expect(snapshot.players.find(({ name }) => name === "Ana")?.aloneCount).toBe(1);
    expect(snapshot.players.find(({ name }) => name === "Ana")?.out).toBe(false);
  });

  it("odd-one-eliminated: the same position removes them", async () => {
    const { snapshot } = await openScenario("odd-one-eliminated");
    expect(snapshot.players.find(({ name }) => name === "Ana")?.out).toBe(true);
  });

  it("spelling-split: normalisation leaves a pair and keeps ocean separate", async () => {
    const { snapshot } = await openScenario("spelling-split");
    expect(snapshot.result?.clusters.find(({ label }) => label === "sea")?.playerIds).toHaveLength(
      2,
    );
    expect(
      snapshot.result?.clusters.find(({ label }) => label === "ocean")?.playerIds,
    ).toHaveLength(1);
  });

  it("punctuation-only: four agree after normalisation", async () => {
    const { snapshot } = await openScenario("punctuation-only");
    expect(
      snapshot.result?.clusters.find(({ label }) => label === "butter")?.playerIds,
    ).toHaveLength(4);
  });

  it("dead-split: nobody scores", async () => {
    const { snapshot } = await openScenario("dead-split");
    expect(snapshot.result?.herdIndex).toBeNull();
    expect(snapshot.result?.noScoreReason).toBe("split");
    expect(snapshot.players.every(({ score }) => score === 0)).toBe(true);
  });

  it("all-alone: no herd and no odd one either", async () => {
    const { snapshot } = await openScenario("all-alone");
    expect(snapshot.result?.herdIndex).toBeNull();
    expect(snapshot.result?.oddPlayerId).toBeNull();
  });

  it("unanimous: one point each, not two", async () => {
    const { snapshot } = await openScenario("unanimous");
    expect(snapshot.result?.pointsEach).toBe(1);
  });

  it("three-players: a pair is a herd and the third is odd", async () => {
    const { snapshot } = await openScenario("three-players");
    expect(snapshot.result?.pointsEach).toBe(2);
    expect(snapshot.result?.oddPlayerId).toBeTruthy();
  });
});
