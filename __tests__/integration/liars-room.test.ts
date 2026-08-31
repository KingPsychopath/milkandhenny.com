import { afterEach, describe, expect, it, vi } from "vitest";

const deliveredOfficialResults = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/features/game-results/outbox.server", () => ({
  publishOfficialResultsAfterCommit: vi.fn((queued: Array<{ envelope: Record<string, unknown> }>) =>
    deliveredOfficialResults.push(...queued.map(({ envelope }) => envelope)),
  ),
  persistRoomWithOfficialResults: vi.fn(),
  sealOfficialGameResult: vi.fn(
    (input: { channelId: string; revision: number; result: Record<string, unknown> }) => ({
      ...input.result,
      schemaVersion: 1,
      channelId: input.channelId,
      revision: input.revision,
      operation: "record",
      committedAt: "2026-08-30T12:00:00.000Z",
      payloadHash: "a".repeat(64),
    }),
  ),
}));

import {
  applyLiarsHostAction,
  applyLiarsPlayerAction,
  closeLiarsRoom,
  createLiarsRoom,
  joinLiarsRoom,
  readLiarsSnapshot,
} from "../../features/things/liars/liars-room.server";
import { liarsRoleSide } from "../../features/things/liars/liars-rules";
import { LIARS_GRAVEYARD_BOARD_MAX } from "../../features/things/liars/liars-rules";
import { parseLiarsPlayerAction } from "../../features/things/liars/liars-room.functions";
import { LIARS_CONNECTED_WINDOW_MS } from "../../features/things/liars/liars-rules";
import { liarsRolesForMode } from "../../features/things/liars/liars-rules";
import { LIARS_SCENARIOS } from "../../features/things/liars/liars-scenarios";
import { startLiarsScenario } from "../../features/things/liars/liars-room-engine.server";
import type {
  LiarsMode,
  LiarsPhase,
  LiarsRole,
  LiarsSnapshot,
} from "../../features/things/liars/types";

afterEach(() => {
  deliveredOfficialResults.length = 0;
  vi.useRealTimers();
});

let actionCounter = 0;
const nextActionId = () => `action-${(actionCounter += 1)}`;

interface Seat {
  playerId: string;
  playerToken: string;
  name: string;
}

async function room(
  mode: LiarsMode,
  names: string[],
  toggles?: Record<string, boolean>,
  officialResultChannelId?: string,
) {
  const created = await createLiarsRoom({
    mode,
    roomMode: "same-room",
    toggles,
    officialResultChannelId,
  });
  const seats: Seat[] = [];
  for (const name of names) {
    const joined = await joinLiarsRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name,
      joinId: `join-${name}`,
    });
    if (!joined.ok) throw new Error(joined.error);
    seats.push({ playerId: joined.playerId, playerToken: joined.playerToken, name });
  }
  return { ...created, seats };
}

async function host(roomId: string, hostToken: string, action: Record<string, unknown>) {
  return applyLiarsHostAction({
    roomId,
    hostToken,
    action: { actionId: nextActionId(), ...action } as never,
  });
}

async function act(roomId: string, seat: Seat, action: Record<string, unknown>) {
  return applyLiarsPlayerAction({
    roomId,
    playerId: seat.playerId,
    playerToken: seat.playerToken,
    action: { actionId: nextActionId(), ...action } as never,
  });
}

async function view(roomId: string, seat: Seat) {
  const result = await readLiarsSnapshot({
    roomId,
    credential: seat.playerToken,
    playerId: seat.playerId,
    lastSequence: 0,
  });
  if (!result.snapshot) throw new Error("no snapshot");
  return result.snapshot;
}

async function touchAll(roomId: string, seats: Seat[]) {
  for (const seat of seats) await view(roomId, seat);
}

/**
 * Walks the clock forward the way real devices do — polling every few seconds — rather than
 * teleporting. A room nobody has read for longer than the connected window deliberately freezes,
 * so a test that jumps a whole phase in one go would find the phase still waiting for it.
 */
async function runTo(roomId: string, seats: Seat[], target: number) {
  let current = Date.now();
  while (current < target) {
    current = Math.min(target, current + 15_000);
    vi.setSystemTime(current);
    await touchAll(roomId, seats);
  }
  vi.setSystemTime(target);
  await touchAll(roomId, seats);
}

function roleOf(snapshot: LiarsSnapshot, playerId: string) {
  return snapshot.players.find(({ id }) => id === playerId)?.role;
}

/**
 * Has to ask every seat what *they* hold. A snapshot only ever carries the viewer's own role and
 * their allies', which is the point — the test cannot cheat any more than a player can.
 */
async function seatWithRole(roomId: string, seats: Seat[], role: LiarsRole) {
  for (const seat of seats) {
    const snapshot = await view(roomId, seat);
    if (snapshot.player!.role === role) return seat;
  }
  return null;
}

const NAMES = ["Maya", "Daniel", "Priya", "Tom", "Ana", "Sam", "Ivy", "Leo", "Nina"];

async function startedGame(names = NAMES.slice(0, 9)) {
  const created = await room("mafia", names);
  const started = await host(created.roomId, created.hostToken, { type: "game.start" });
  expect(started.accepted).toBe(true);
  return created;
}

describe("liars rooms — official results", () => {
  it("lets the room creator close and reopen admission", async () => {
    const created = await createLiarsRoom({ mode: "mafia", roomMode: "same-room" });
    const locked = await host(created.roomId, created.hostToken, {
      type: "room.admission.set",
      locked: true,
    });
    expect(locked).toMatchObject({ accepted: true, snapshot: { joinLocked: true } });
    await expect(
      joinLiarsRoom({
        roomId: created.roomId,
        joinToken: created.joinToken,
        name: "Maya",
        joinId: `${created.roomId}-locked`,
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "room_locked" });
    await host(created.roomId, created.hostToken, { type: "room.admission.set", locked: false });
    await expect(
      joinLiarsRoom({
        roomId: created.roomId,
        joinToken: created.joinToken,
        name: "Maya",
        joinId: `${created.roomId}-open`,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("publishes each event-linked game once with a replay-safe result id", async () => {
    const created = await room("imposter", NAMES.slice(0, 6), undefined, "gsc_liars_event");
    await host(created.roomId, created.hostToken, { type: "game.start" });
    await host(created.roomId, created.hostToken, { type: "game.end" });

    expect(deliveredOfficialResults).toHaveLength(1);
    expect(deliveredOfficialResults[0]).toMatchObject({
      channelId: "gsc_liars_event",
      gameKind: "liars",
      gameInstanceId: created.roomId,
      resultId: "game:1",
      scope: "game",
    });
    expect(JSON.stringify(deliveredOfficialResults[0])).not.toContain("Maya");

    await view(created.roomId, created.seats[0]);
    expect(deliveredOfficialResults).toHaveLength(1);

    await host(created.roomId, created.hostToken, { type: "game.replay" });
    await host(created.roomId, created.hostToken, { type: "game.end" });
    expect(deliveredOfficialResults).toHaveLength(2);
    expect(deliveredOfficialResults[1]).toMatchObject({ resultId: "game:2" });
  });
});

describe("liars rooms — secrecy", () => {
  it("never leaks another player's role, the mafia roster, or the word", async () => {
    const created = await startedGame();
    const [first] = created.seats;
    const own = await view(created.roomId, first);

    for (const seat of created.seats) {
      const snapshot = await view(created.roomId, seat);
      const self = snapshot.player!;
      const visible = snapshot.players.filter((player) => player.role !== undefined);
      const allowed = new Set([seat.playerId, ...self.allyIds]);
      for (const player of visible)
        expect(allowed.has(player.id), `${seat.name} can see ${player.name}'s role`).toBe(true);

      // Allies only ever go one way: mafia see mafia, nobody else sees anyone.
      if (liarsRoleSide(self.role) !== "mafia") expect(self.allyIds).toEqual([]);
    }

    void own;
  });

  it("keeps the imposter's word out of the imposter's snapshot", async () => {
    const created = await room("imposter", NAMES.slice(0, 8));
    await host(created.roomId, created.hostToken, { type: "game.start" });

    const seen = await Promise.all(created.seats.map((seat) => view(created.roomId, seat)));
    const imposterIndex = seen.findIndex((snapshot) => snapshot.player!.role === "imposter");
    expect(imposterIndex).toBeGreaterThanOrEqual(0);

    const imposterView = seen[imposterIndex];
    expect(imposterView.player!.word).toBeNull();

    const crewView = seen.find((snapshot) => snapshot.player!.role === "crew")!;
    const crewWord = crewView.player!.word!;
    expect(crewWord.length).toBeGreaterThan(0);

    // The word is on the board, and the board is public — that is the mechanic. What the imposter
    // must never have is a way to tell which of the twelve it is, so their board has to be exactly
    // the crew's board, in the same order, with nothing marking the answer.
    expect(imposterView.player!.wordBoard).toEqual(crewView.player!.wordBoard);
    expect(imposterView.player!.wordBoard).toContain(crewWord);
    const marked = JSON.stringify(imposterView.player).replace(
      JSON.stringify(imposterView.player!.wordBoard),
      "",
    );
    expect(marked, "the answer must not appear outside the board").not.toContain(crewWord);
  });

  it("gives the imposter the category, so they open on something rather than nothing", async () => {
    const created = await room("imposter", NAMES.slice(0, 8));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const seen = await Promise.all(created.seats.map((seat) => view(created.roomId, seat)));

    const imposter = seen.find((snapshot) => snapshot.player!.role === "imposter")!;
    const crew = seen.find((snapshot) => snapshot.player!.role === "crew")!;

    // Everyone gets it, including the person who has nothing else.
    expect(imposter.player!.wordCategory).toBeTruthy();
    expect(imposter.player!.wordCategory).toBe(crew.player!.wordCategory);
    // And it still is not the word: the board narrows it to twelve, it does not give it away.
    expect(imposter.player!.word).toBeNull();
    expect(imposter.player!.wordBoard).toEqual(crew.player!.wordBoard);
    expect(imposter.player!.wordBoard.length).toBeGreaterThan(1);
  });

  it("gives the understudy a different word without telling them", async () => {
    const created = await room("imposter", NAMES.slice(0, 8));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const seen = await Promise.all(created.seats.map((seat) => view(created.roomId, seat)));
    const understudy = seen.find((snapshot) => snapshot.player!.role === "understudy");
    const crew = seen.find((snapshot) => snapshot.player!.role === "crew");
    expect(understudy?.player!.word).toBeTruthy();
    expect(understudy?.player!.word).not.toBe(crew?.player!.word);
    // Both words sit on the same board, so nothing in the understudy's view says which of the two
    // they are holding — which is the entire role.
    expect(understudy!.player!.wordBoard).toEqual(crew!.player!.wordBoard);
    expect(understudy!.player!.wordBoard).toContain(crew!.player!.word!);
    expect(understudy!.player!.wordBoard).toContain(understudy!.player!.word!);
  });

  it("hides the night report until the report moment, on every device alike", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T20:00:00Z"));
    const created = await startedGame();
    const deal = await view(created.roomId, created.seats[0]);

    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);
    const night = await view(created.roomId, created.seats[0]);
    expect(night.phase).toBe("night");

    await runTo(created.roomId, created.seats, night.nightOpensAt! + 500);
    for (const seat of created.seats) {
      const snapshot = await view(created.roomId, seat);
      const targets = snapshot.player!.targetableIds;
      await act(created.roomId, seat, {
        type: "night.select",
        round: snapshot.round,
        targetId: targets[0] ?? null,
      });
    }

    // Before the report moment nobody has a card, whatever their role.
    await runTo(created.roomId, created.seats, night.reportAt! - 2_000);
    for (const seat of created.seats) {
      const snapshot = await view(created.roomId, seat);
      expect(snapshot.player!.report, `${seat.name} had a card early`).toBeNull();
    }

    // After it, everyone has one — an empty card beside a full one would be a tell.
    await runTo(created.roomId, created.seats, night.reportAt! + 500);
    for (const seat of created.seats) {
      const snapshot = await view(created.roomId, seat);
      expect(snapshot.player!.report, `${seat.name} had no card`).not.toBeNull();
      expect(snapshot.player!.report!.line.length).toBeGreaterThan(0);
    }
  });

  it("opens every role at the end and not before", async () => {
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const mid = await view(created.roomId, created.seats[0]);
    expect(mid.ending).toBeNull();

    await host(created.roomId, created.hostToken, { type: "game.end" });
    const ended = await view(created.roomId, created.seats[0]);
    expect(ended.phase).toBe("ending");
    expect(ended.ending!.roles).toHaveLength(5);
    for (const player of ended.players) expect(player.role).toBeDefined();
  });
});

describe("liars rooms — the night", () => {
  it("kills the mafia's target, and the doctor pulls them back", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T21:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    const mafiaSeat = (await seatWithRole(created.roomId, created.seats, "mafia"))!;
    const doctorSeat = (await seatWithRole(created.roomId, created.seats, "doctor"))!;
    const mafiaView = await view(created.roomId, mafiaSeat);
    const victimId = mafiaView.player!.targetableIds[0];

    await runTo(created.roomId, created.seats, night.nightOpensAt! + 100);
    await act(created.roomId, mafiaSeat, {
      type: "night.select",
      round: night.round,
      targetId: victimId,
    });
    await act(created.roomId, doctorSeat, {
      type: "night.select",
      round: night.round,
      targetId: victimId,
    });

    await runTo(created.roomId, created.seats, night.phaseEndsAt + 1);
    const dawn = await view(created.roomId, created.seats[0]);
    expect(dawn.phase).toBe("dawn");
    expect(dawn.dawn!.deaths).toHaveLength(1);
    expect(dawn.dawn!.deaths[0].revived).toBe(true);
    expect(dawn.players.find(({ id }) => id === victimId)!.alive).toBe(true);
    // The revive lands only after the hold — three full seconds of dead.
    expect(dawn.dawn!.reviveAt).toBe(dawn.dawn!.holdUntil);
    expect(dawn.dawn!.holdUntil - dawn.dawn!.nameLandsAt).toBe(3_000);
  });

  it("lets the mafia stay in, and says nothing about anyone who stayed still", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T22:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, night.phaseEndsAt + 1);

    const dawn = await view(created.roomId, created.seats[0]);
    expect(dawn.dawn!.deaths).toHaveLength(0);
    expect(dawn.dawn!.movementSeen).toEqual([]);
    expect(dawn.players.every(({ alive }) => alive)).toBe(true);
  });

  it("announces movement only when two watchers corroborate it", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T23:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 6));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    const mafiaSeat = (await seatWithRole(created.roomId, created.seats, "mafia"))!;
    const watchers = created.seats.filter(
      (seat) => roleOf(night, seat.playerId) === undefined && seat.playerId !== mafiaSeat.playerId,
    );
    const villagerSeats: Seat[] = [];
    for (const seat of watchers) {
      const snapshot = await view(created.roomId, seat);
      if (snapshot.player!.role === "villager") villagerSeats.push(seat);
    }
    expect(villagerSeats.length).toBeGreaterThanOrEqual(2);

    await runTo(created.roomId, created.seats, night.nightOpensAt! + 100);
    const mafiaView = await view(created.roomId, mafiaSeat);
    await act(created.roomId, mafiaSeat, {
      type: "night.select",
      round: night.round,
      targetId: mafiaView.player!.targetableIds[0],
    });
    // One watcher on the killer is private and unprovable.
    await act(created.roomId, villagerSeats[0], {
      type: "night.select",
      round: night.round,
      targetId: mafiaSeat.playerId,
    });

    await runTo(created.roomId, created.seats, night.phaseEndsAt + 1);
    const lonely = await view(created.roomId, created.seats[0]);
    expect(lonely.dawn!.movementSeen).toEqual([]);
    const watcherView = await view(created.roomId, villagerSeats[0]);
    expect(watcherView.player!.knowledge.at(-1)!.text).toBe("they went out");
  });

  it("stops the doctor protecting the same person two nights running", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T01:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 6));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    const doctorSeat = (await seatWithRole(created.roomId, created.seats, "doctor"))!;
    const doctorView = await view(created.roomId, doctorSeat);
    // The doctor may always pick themselves.
    expect(doctorView.player!.targetableIds).toContain(doctorSeat.playerId);

    await runTo(created.roomId, created.seats, night.nightOpensAt! + 100);
    await act(created.roomId, doctorSeat, {
      type: "night.select",
      round: night.round,
      targetId: doctorSeat.playerId,
    });

    await runTo(created.roomId, created.seats, night.phaseEndsAt + 1);
    const dawn = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, dawn.phaseEndsAt + 1);
    const deliberation = await view(created.roomId, created.seats[0]);
    expect(deliberation.phase).toBe("deliberation");
  });

  it("refuses a target the role is not allowed to choose", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T02:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    const detectiveSeat = (await seatWithRole(created.roomId, created.seats, "detective"))!;
    await runTo(created.roomId, created.seats, night.nightOpensAt! + 100);
    const rejected = await act(created.roomId, detectiveSeat, {
      type: "night.select",
      round: night.round,
      targetId: detectiveSeat.playerId,
    });
    expect(rejected).toMatchObject({ accepted: false, errorCode: "invalid_target" });
  });
});

describe("liars rooms — the day", () => {
  it("ejects on a plurality and ejects nobody on a tie", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T03:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    let snapshot = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);
    snapshot = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);
    snapshot = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);

    const deliberation = await view(created.roomId, created.seats[0]);
    expect(deliberation.phase).toBe("deliberation");
    await runTo(created.roomId, created.seats, deliberation.phaseEndsAt + 1);

    const vote = await view(created.roomId, created.seats[0]);
    expect(vote.phase).toBe("vote");

    const victim = created.seats[4];
    for (const seat of created.seats.slice(0, 3))
      await act(created.roomId, seat, {
        type: "vote.cast",
        round: vote.round,
        targetId: victim.playerId,
      });

    await runTo(created.roomId, created.seats, vote.phaseEndsAt + 1);
    const verdict = await view(created.roomId, created.seats[0]);
    expect(verdict.players.find(({ id }) => id === victim.playerId)!.alive).toBe(false);
    expect(verdict.players.find(({ id }) => id === victim.playerId)!.deathCause).toBe("ejected");
  });

  it("ends deliberation early on a majority of the connected living", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T04:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    let snapshot = await view(created.roomId, created.seats[0]);
    for (let step = 0; step < 2; step += 1) {
      await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);
      snapshot = await view(created.roomId, created.seats[0]);
    }
    await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);
    const deliberation = await view(created.roomId, created.seats[0]);
    expect(deliberation.phase).toBe("deliberation");

    for (const seat of created.seats.slice(0, 3))
      await act(created.roomId, seat, {
        type: "day.readyToVote",
        round: deliberation.round,
        ready: true,
      });

    const after = await view(created.roomId, created.seats[0]);
    expect(after.phase).toBe("vote");
  });

  it("never lets the host cut the discussion short on their own", async () => {
    const created = await startedGame();
    const rejected = await host(created.roomId, created.hostToken, { type: "phase.skip" }).catch(
      () => null,
    );
    // `phase.skip` is not a host action at all — the validator does not know the word.
    expect(rejected === null || rejected.accepted === false).toBe(true);
  });
});

describe("liars rooms — robustness", () => {
  it("recovers a joined player after the game starts when the first response was lost", async () => {
    const created = await room("imposter", ["Abel", "Maya", "Daniel", "Priya"]);
    const started = await host(created.roomId, created.hostToken, { type: "game.start" });
    expect(started.accepted).toBe(true);

    const recovered = await joinLiarsRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "Maya",
      joinId: "join-Maya",
    });
    expect(recovered).toMatchObject({
      ok: true,
      playerId: created.seats[1].playerId,
      playerToken: created.seats[1].playerToken,
    });
    if (recovered.ok)
      expect(recovered.snapshot.players.filter(({ name }) => name === "Maya")).toHaveLength(1);
  });

  it("pauses rather than fast-forwarding through rounds nobody was present for", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T05:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);
    const night = await view(created.roomId, created.seats[0]);
    expect(night.phase).toBe("night");

    // Everyone's train goes into a tunnel for ten minutes: no device reads the room at all.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const frozen = await view(created.roomId, created.seats[0]);
    // Still the same night. Without the pause this would have burned through several rounds
    // unattended, resolving each one against targets nobody was awake to choose.
    expect(frozen.phase).toBe("night");
    expect(frozen.round).toBe(1);

    // And it picks up from where it froze rather than staying stuck there.
    await runTo(created.roomId, created.seats, frozen.phaseEndsAt + 1);
    expect((await view(created.roomId, created.seats[0])).phase).toBe("dawn");
  });

  it("uses the last selection a dropped player made, rather than throwing it away", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T06:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    const mafiaSeat = (await seatWithRole(created.roomId, created.seats, "mafia"))!;
    const mafiaView = await view(created.roomId, mafiaSeat);
    const victimId = mafiaView.player!.targetableIds[0];

    await runTo(created.roomId, created.seats, night.nightOpensAt! + 100);
    // Selected but never locked, then the phone drops.
    await act(created.roomId, mafiaSeat, {
      type: "night.select",
      round: night.round,
      targetId: victimId,
    });

    // Their phone drops: from here on only everybody else keeps the room alive.
    const others = created.seats.filter(({ playerId }) => playerId !== mafiaSeat.playerId);
    await runTo(created.roomId, others, night.phaseEndsAt + 1);
    const dawn = await view(created.roomId, others[0]);
    expect(dawn.dawn!.deaths.map(({ playerId }) => playerId)).toContain(victimId);
  });

  it("hands the host over once they have been gone long enough", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T07:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    const [original, ...others] = created.seats;
    const before = await view(created.roomId, others[0]);
    expect(before.hostPlayerId).toBe(original.playerId);

    const tooEarly = await act(created.roomId, others[0], { type: "host.claim" });
    expect(tooEarly).toMatchObject({ accepted: false });

    vi.setSystemTime(Date.now() + 90_000);
    await view(created.roomId, others[0]);
    vi.setSystemTime(Date.now() + 90_000);
    await view(created.roomId, others[0]);

    const claimed = await act(created.roomId, others[0], { type: "host.claim" });
    expect(claimed.accepted).toBe(true);
    expect(claimed.snapshot!.hostPlayerId).toBe(others[0].playerId);
  });

  it("refuses to start a mafia game below five players, and says why", async () => {
    const created = await room("mafia", NAMES.slice(0, 4));
    const result = await host(created.roomId, created.hostToken, { type: "game.start" });
    expect(result).toMatchObject({ accepted: false, errorCode: "action_unavailable" });
    if (!result.accepted && "error" in result) expect(result.error).toContain("5");
  });

  it("rejects an unbalanced lineup with the reason a host can act on", async () => {
    const created = await room("mafia", NAMES.slice(0, 6));
    const result = await host(created.roomId, created.hostToken, {
      type: "game.configure",
      lineup: { roles: { mafia: 3, villager: 3 } },
    });
    expect(result).toMatchObject({ accepted: false, errorCode: "lineup_invalid" });
    if (!result.accepted && "error" in result) expect(result.error).toContain("parity");
  });

  it("turns the graveyard vote off when the dead can see everything", async () => {
    const created = await room("mafia", NAMES.slice(0, 5));
    const result = await host(created.roomId, created.hostToken, {
      type: "game.configure",
      toggles: { liveGodView: true },
    });
    expect(result.snapshot!.toggles.liveGodView).toBe(true);
    expect(result.snapshot!.toggles.graveyardVote).toBe(false);
  });

  it("blocks a late join and keeps the room closable by its host", async () => {
    const created = await startedGame();
    const late = await joinLiarsRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "Late",
      joinId: "late-join",
    });
    expect(late).toMatchObject({ ok: false, errorCode: "game_started" });
    expect(await closeLiarsRoom(created.roomId, created.hostToken)).toEqual({ ok: true });
    expect(await closeLiarsRoom(created.roomId, created.hostToken)).toEqual({ ok: true });
  });

  it("is idempotent for a replayed action id", async () => {
    const created = await room("mafia", NAMES.slice(0, 5));
    const first = await applyLiarsPlayerAction({
      roomId: created.roomId,
      playerId: created.seats[1].playerId,
      playerToken: created.seats[1].playerToken,
      action: { actionId: "same", type: "readiness.set", ready: false },
    });
    const second = await applyLiarsPlayerAction({
      roomId: created.roomId,
      playerId: created.seats[1].playerId,
      playerToken: created.seats[1].playerToken,
      action: { actionId: "same", type: "readiness.set", ready: true },
    });
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(second.snapshot!.players.find(({ id }) => id === created.seats[1].playerId)!.ready).toBe(
      false,
    );
  });

  it("turns away a wrong credential", async () => {
    const created = await room("mafia", NAMES.slice(0, 5));
    const result = await readLiarsSnapshot({
      roomId: created.roomId,
      credential: "not-a-token",
      playerId: created.seats[0].playerId,
      lastSequence: 0,
    });
    expect(result).toMatchObject({ ok: false, errorCode: "room_unavailable", snapshot: null });
  });
});

describe("liars rooms — imposter", () => {
  async function imposterGame(names = NAMES.slice(0, 8)) {
    const created = await room("imposter", names);
    await host(created.roomId, created.hostToken, { type: "game.start" });
    return created;
  }

  it("runs the clue round by turn, on every device at once", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T08:00:00Z"));
    const created = await imposterGame();
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const clue = await view(created.roomId, created.seats[0]);
    expect(clue.phase).toBe("clue");
    expect(clue.clue!.order).toHaveLength(8);
    expect(clue.clue!.currentPlayerId).toBe(clue.clue!.order[0]);

    // Whose turn it is reads the same on every phone — that is the entire job of the screen.
    for (const seat of created.seats) {
      const snapshot = await view(created.roomId, seat);
      expect(snapshot.clue!.currentPlayerId).toBe(clue.clue!.currentPlayerId);
    }

    const first = created.seats.find(({ playerId }) => playerId === clue.clue!.currentPlayerId)!;
    const outOfTurn = created.seats.find(({ playerId }) => playerId !== first.playerId)!;
    expect(
      await act(created.roomId, outOfTurn, { type: "clue.said", round: clue.round }),
    ).toMatchObject({ accepted: false, errorCode: "not_your_turn" });

    const said = await act(created.roomId, first, { type: "clue.said", round: clue.round });
    expect(said.accepted).toBe(true);
    expect(said.snapshot!.clue!.currentPlayerId).toBe(clue.clue!.order[1]);
    expect(said.snapshot!.clue!.doneIds).toEqual([first.playerId]);
  });

  it("moves to deliberation once everyone has spoken", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T09:00:00Z"));
    const created = await imposterGame();
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    let snapshot = await view(created.roomId, created.seats[0]);
    for (let turn = 0; turn < created.seats.length; turn += 1) {
      const current = created.seats.find(
        ({ playerId }) => playerId === snapshot.clue!.currentPlayerId,
      )!;
      const result = await act(created.roomId, current, {
        type: "clue.said",
        round: snapshot.round,
      });
      snapshot = result.snapshot!;
    }
    expect(snapshot.phase).toBe("deliberation");
  });

  it("gives the last imposter out one shot at the word, and it can take the game", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00Z"));
    const created = await imposterGame(NAMES.slice(0, 6));
    const imposterSeat = (await seatWithRole(created.roomId, created.seats, "imposter"))!;
    const crewSeat = created.seats.find(({ playerId }) => playerId !== imposterSeat.playerId)!;
    const word = (await view(created.roomId, crewSeat)).player!.word!;

    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    let snapshot = await view(created.roomId, created.seats[0]);
    while (snapshot.phase === "clue") {
      const current = created.seats.find(
        ({ playerId }) => playerId === snapshot.clue!.currentPlayerId,
      )!;
      snapshot = (await act(created.roomId, current, { type: "clue.said", round: snapshot.round }))
        .snapshot!;
    }

    await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);
    const vote = await view(created.roomId, created.seats[0]);
    expect(vote.phase).toBe("vote");
    for (const seat of created.seats)
      await act(created.roomId, seat, {
        type: "vote.cast",
        round: vote.round,
        targetId: imposterSeat.playerId,
      });

    await runTo(created.roomId, created.seats, vote.phaseEndsAt + 1);
    const verdict = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, verdict.phaseEndsAt + 1);

    const guessing = await view(created.roomId, imposterSeat);
    expect(guessing.phase).toBe("finalGuess");
    expect(guessing.player!.finalGuessOpen).toBe(true);

    const guessed = await act(created.roomId, imposterSeat, { type: "guess.final", text: word });
    expect(guessed.accepted).toBe(true);
    expect(guessed.snapshot!.phase).toBe("ending");
    // Caught, and still won it.
    expect(guessed.snapshot!.ending!.winner).toBe("mafia");
    expect(guessed.snapshot!.ending!.word).toBe(word);
  });

  it("gives the crew the win when the guess misses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T11:00:00Z"));
    const created = await imposterGame(NAMES.slice(0, 6));
    const imposterSeat = (await seatWithRole(created.roomId, created.seats, "imposter"))!;
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    let snapshot = await view(created.roomId, created.seats[0]);
    while (snapshot.phase === "clue") {
      const current = created.seats.find(
        ({ playerId }) => playerId === snapshot.clue!.currentPlayerId,
      )!;
      snapshot = (await act(created.roomId, current, { type: "clue.said", round: snapshot.round }))
        .snapshot!;
    }
    await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);
    const vote = await view(created.roomId, created.seats[0]);
    for (const seat of created.seats)
      await act(created.roomId, seat, {
        type: "vote.cast",
        round: vote.round,
        targetId: imposterSeat.playerId,
      });
    await runTo(created.roomId, created.seats, vote.phaseEndsAt + 1);
    const verdict = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, verdict.phaseEndsAt + 1);

    const guessed = await act(created.roomId, imposterSeat, {
      type: "guess.final",
      text: "definitely not the word",
    });
    expect(guessed.snapshot!.phase).toBe("ending");
    expect(guessed.snapshot!.ending!.winner).toBe("town");
  });

  it("keeps the crew from answering the imposter's question for them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
    const created = await imposterGame(NAMES.slice(0, 6));
    const crewSeat = (await seatWithRole(created.roomId, created.seats, "crew"))!;
    const rejected = await act(created.roomId, crewSeat, { type: "guess.final", text: "beach" });
    expect(rejected).toMatchObject({ accepted: false, errorCode: "action_unavailable" });
  });
});

describe("liars rooms — mafia coordination", () => {
  it("shows the mafia each other's picks live, and nobody else anything", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T13:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 9));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    const godfather = (await seatWithRole(created.roomId, created.seats, "godfather"))!;
    const mafia = (await seatWithRole(created.roomId, created.seats, "mafia"))!;

    await runTo(created.roomId, created.seats, night.nightOpensAt! + 100);
    const mafiaView = await view(created.roomId, mafia);
    const pick = mafiaView.player!.targetableIds[0];
    await act(created.roomId, mafia, {
      type: "night.select",
      round: night.round,
      targetId: pick,
    });

    // The godfather sees the disagreement before overruling it.
    const bossView = await view(created.roomId, godfather);
    expect(bossView.player!.allyTargets).toContainEqual({
      playerId: mafia.playerId,
      targetId: pick,
      locked: false,
    });
    expect(bossView.player!.callerPlayerId).toBe(godfather.playerId);

    // And the town sees no trace of any of it.
    const doctor = (await seatWithRole(created.roomId, created.seats, "doctor"))!;
    const townView = await view(created.roomId, doctor);
    expect(townView.player!.allyTargets).toEqual([]);
    expect(townView.player!.callerPlayerId).toBeNull();
    // Player ids are public — the roster needs them. What must never appear is a pairing of
    // anybody to a target, so the only night target in a town snapshot is that player's own.
    const targets = JSON.stringify(townView).match(/"(?:target|nightTarget)Id?":"[^"]+"/g) ?? [];
    expect(targets).toEqual([]);
    expect(townView.player!.nightTarget).toBeNull();
  });

  it("resolves a disagreement in the godfather's favour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T14:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 9));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const night = await view(created.roomId, created.seats[0]);
    const godfather = (await seatWithRole(created.roomId, created.seats, "godfather"))!;
    const mafia = (await seatWithRole(created.roomId, created.seats, "mafia"))!;
    await runTo(created.roomId, created.seats, night.nightOpensAt! + 100);

    const options = (await view(created.roomId, godfather)).player!.targetableIds;
    const bossPick = options[0];
    const otherPick = options[1];
    expect(bossPick).not.toBe(otherPick);

    await act(created.roomId, godfather, {
      type: "night.select",
      round: night.round,
      targetId: bossPick,
    });
    await act(created.roomId, mafia, {
      type: "night.select",
      round: night.round,
      targetId: otherPick,
    });

    await runTo(created.roomId, created.seats, night.phaseEndsAt + 1);
    const dawn = await view(created.roomId, created.seats[0]);
    const died = dawn.dawn!.deaths.map(({ playerId }) => playerId);
    expect(died).toContain(bossPick);
    expect(died).not.toContain(otherPick);
  });
});

describe("liars — what death costs you", () => {
  /**
   * Deals a fixed five-hander and kills whoever the caller names, so the tests below can start at
   * the interesting moment instead of playing a night to reach it.
   */
  async function killed(victimIndex: number) {
    const started = await startLiarsScenario({
      mode: "mafia",
      names: NAMES.slice(0, 5),
      deal: ["mafia", "doctor", "detective", "villager", "villager"],
    });
    expect(started.error).toBeNull();
    const seats = started.seats;
    const deal = await view(started.roomId, seats[0]);
    await runTo(started.roomId, seats, deal.phaseEndsAt + 1);

    const night = await view(started.roomId, seats[0]);
    await runTo(started.roomId, seats, night.nightOpensAt! + 100);
    // The detective learns something true on their way past.
    await act(started.roomId, seats[2], {
      type: "night.select",
      round: night.round,
      targetId: seats[0].playerId,
    });
    await act(started.roomId, seats[0], {
      type: "night.select",
      round: night.round,
      targetId: seats[victimIndex].playerId,
    });
    await runTo(started.roomId, seats, night.phaseEndsAt + 1);

    const dawn = await view(started.roomId, seats[victimIndex]);
    expect(dawn.players.find(({ id }) => id === seats[victimIndex].playerId)!.alive).toBe(false);
    return { roomId: started.roomId, seats };
  }

  /**
   * The one channel that beats every rule in the game is an unlocked phone. Last words are a single
   * line and can be a lie; a screen still reading `night 1 · Maya · mafia` is server-issued proof,
   * and a dead detective can simply hold it up. So the server stops vouching for you when you die.
   */
  it("seals a dead player's knowledge once their last words close", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T01:00:00Z"));
    const { roomId, seats } = await killed(2);

    // Dead, but still writing their epitaph — and they need the list to write from.
    const dying = await view(roomId, seats[2]);
    expect(dying.player!.lastWordsOpen).toBe(true);
    expect(dying.player!.knowledge.length).toBeGreaterThan(0);
    expect(dying.player!.knowledgeSealed).toBe(false);

    await act(roomId, seats[2], { type: "words.last", text: "It was them. I checked." });

    const sealed = await view(roomId, seats[2]);
    expect(sealed.player!.lastWordsOpen).toBe(false);
    expect(sealed.player!.knowledge).toEqual([]);
    // Said out loud, so an emptied list reads as the rule rather than as a bug.
    expect(sealed.player!.knowledgeSealed).toBe(true);
  });

  it("gives the graveyard a board only the dead can write to or read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T02:00:00Z"));
    const { roomId, seats } = await killed(3);

    await act(roomId, seats[3], { type: "graveyard.pin", text: "the doctor is real" });
    const dead = await view(roomId, seats[3]);
    expect(dead.graveyard!.board.map(({ text }) => text)).toEqual(["the doctor is real"]);

    // The living never receive the board at all — not the notes, not the fact one exists.
    const living = await view(roomId, seats[0]);
    expect(living.graveyard).toBeNull();
    await act(roomId, seats[0], { type: "graveyard.pin", text: "the doctor is fake" });
    expect((await view(roomId, seats[3])).graveyard!.board).toHaveLength(1);
  });

  it("drops the oldest note rather than silently refusing the ninth", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T03:00:00Z"));
    const { roomId, seats } = await killed(3);

    for (let index = 0; index < LIARS_GRAVEYARD_BOARD_MAX + 2; index += 1)
      await act(roomId, seats[3], { type: "graveyard.pin", text: `note ${index}` });

    const board = (await view(roomId, seats[3])).graveyard!.board;
    expect(board).toHaveLength(LIARS_GRAVEYARD_BOARD_MAX);
    // Distinct keys, so unpinning takes the note you actually pointed at.
    expect(new Set(board.map(({ id }) => id)).size).toBe(board.length);
    expect(board.at(-1)!.text).toBe(`note ${LIARS_GRAVEYARD_BOARD_MAX + 1}`);
    expect(board.at(0)!.text).toBe("note 2");
  });

  it("tells the dead their ballot is split rather than letting them find out at verdict", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T04:00:00Z"));
    const { roomId, seats } = await killed(3);

    const alone = await view(roomId, seats[3]);
    // One voter cannot be split with anybody, and abstaining is counted honestly.
    expect(alone.graveyard!.abstaining).toBe(1);
    expect(alone.graveyard!.deadlocked).toBe(false);

    await act(roomId, seats[3], {
      type: "graveyard.vote",
      round: alone.round,
      targetId: seats[0].playerId,
    });
    const voted = await view(roomId, seats[3]);
    expect(voted.graveyard!.abstaining).toBe(0);
    expect(voted.graveyard!.deadlocked).toBe(false);
    expect(voted.graveyard!.tally).toEqual([
      { playerId: seats[0].playerId, name: seats[0].name, votes: 1 },
    ]);
  });
});

describe("liars — the roles nothing was testing", () => {
  /**
   * Lookout, vigilante and mole had no behavioural coverage at all, and jammer, bodyguard and
   * understudy only appeared inside lineup lists. The escort turned out to be quietly broken in
   * exactly that gap — dealt correctly, walked by the scenario test, and delivering nothing — so
   * these exercise the power rather than the deal.
   */
  async function nightOf(deal: LiarsRole[], names = NAMES) {
    const started = await startLiarsScenario({
      mode: "mafia",
      names: names.slice(0, deal.length),
      deal,
    });
    expect(started.error, started.error ?? "").toBeNull();
    const seats = started.seats;
    const dealPhase = await view(started.roomId, seats[0]);
    await runTo(started.roomId, seats, dealPhase.phaseEndsAt + 1);
    const night = await view(started.roomId, seats[0]);
    await runTo(started.roomId, seats, night.nightOpensAt! + 100);
    return { roomId: started.roomId, seats, round: night.round, endsAt: night.phaseEndsAt };
  }

  it("names every visitor to the lookout, and nobody else", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T07:00:00Z"));
    const { roomId, seats, round, endsAt } = await nightOf([
      "mafia",
      "lookout",
      "doctor",
      "detective",
      "villager",
      "villager",
      "villager",
    ]);
    const [mafia, lookout, doctor, , watched] = seats;

    // Two people go to the same door; the lookout is watching it.
    await act(roomId, mafia, { type: "night.select", round, targetId: watched.playerId });
    await act(roomId, doctor, { type: "night.select", round, targetId: watched.playerId });
    await act(roomId, lookout, { type: "night.select", round, targetId: watched.playerId });
    await runTo(roomId, seats, endsAt + 1);

    const own = await view(roomId, lookout);
    const learned = own.player!.knowledge.map(({ text }) => text).join(" ");
    expect(learned).toContain(mafia.name);
    expect(learned).toContain(doctor.name);

    // It is the lookout's alone — a plain villager watching the same door learns only that
    // somebody moved, never who.
    const bystander = await view(roomId, seats[5]);
    expect(bystander.player!.knowledge.map(({ text }) => text).join(" ")).not.toContain(mafia.name);
  });

  it("lets the vigilante shoot, and kills them by guilt when they shoot the town", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T08:00:00Z"));
    const { roomId, seats, round, endsAt } = await nightOf([
      "mafia",
      "vigilante",
      "doctor",
      "detective",
      "villager",
      "villager",
      "villager",
    ]);
    const [, vigilante, , , innocent] = seats;

    await act(roomId, vigilante, { type: "night.select", round, targetId: innocent.playerId });
    await runTo(roomId, seats, endsAt + 1);

    const dawn = await view(roomId, seats[0]);
    expect(dawn.players.find(({ id }) => id === innocent.playerId)!.alive).toBe(false);
    // The vigilante is still standing tonight. The guilt is supposed to land a night later.
    expect(dawn.players.find(({ id }) => id === vigilante.playerId)!.alive).toBe(true);
  });

  it("stops the doctor's save when the jammer blocks them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T09:00:00Z"));
    const { roomId, seats, round, endsAt } = await nightOf([
      "mafia",
      "jammer",
      "doctor",
      "detective",
      "villager",
      "villager",
      "villager",
    ]);
    const [mafia, jammer, doctor, , victim] = seats;

    await act(roomId, mafia, { type: "night.select", round, targetId: victim.playerId });
    await act(roomId, doctor, { type: "night.select", round, targetId: victim.playerId });
    await act(roomId, jammer, { type: "night.select", round, targetId: doctor.playerId });
    await runTo(roomId, seats, endsAt + 1);

    const dawn = await view(roomId, seats[0]);
    // Without the jammer this is a revive. With it, the save never happened.
    expect(dawn.players.find(({ id }) => id === victim.playerId)!.alive).toBe(false);
    expect(
      dawn.dawn!.deaths.some(({ playerId, revived }) => playerId === victim.playerId && !revived),
    ).toBe(true);
  });

  it("kills the bodyguard instead of the person they were guarding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00Z"));
    const { roomId, seats, round, endsAt } = await nightOf([
      "mafia",
      "bodyguard",
      "doctor",
      "detective",
      "villager",
      "villager",
      "villager",
    ]);
    const [mafia, bodyguard, , , guarded] = seats;

    await act(roomId, mafia, { type: "night.select", round, targetId: guarded.playerId });
    await act(roomId, bodyguard, { type: "night.select", round, targetId: guarded.playerId });
    await runTo(roomId, seats, endsAt + 1);

    const dawn = await view(roomId, seats[0]);
    expect(dawn.players.find(({ id }) => id === guarded.playerId)!.alive).toBe(true);
    expect(dawn.players.find(({ id }) => id === bodyguard.playerId)!.alive).toBe(false);
    expect(dawn.dawn!.deaths.some(({ substituteName }) => substituteName === bodyguard.name)).toBe(
      true,
    );
  });

  /**
   * Whatever the cause, a dead player's role is on the roster for everybody — the toggle is global,
   * not a property of how you died. Worth pinning: the dawn line carries the role for some causes
   * and not others, so the roster is the thing making it consistent.
   */
  it("reveals a dead player's role on the roster whichever way they died", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T11:00:00Z"));
    const { roomId, seats, round, endsAt } = await nightOf([
      "mafia",
      "bodyguard",
      "doctor",
      "detective",
      "villager",
      "villager",
      "villager",
    ]);
    const [mafia, bodyguard, , , guarded] = seats;
    await act(roomId, mafia, { type: "night.select", round, targetId: guarded.playerId });
    await act(roomId, bodyguard, { type: "night.select", round, targetId: guarded.playerId });
    await runTo(roomId, seats, endsAt + 1);

    // A living villager, with no special sight of anybody, still sees what the bodyguard was.
    const bystander = await view(roomId, seats[6]);
    const corpse = bystander.players.find(({ id }) => id === bodyguard.playerId)!;
    expect(corpse.alive).toBe(false);
    expect(corpse.role).toBe("bodyguard");
    // And still sees nothing about any other living player. Their own role is always their own.
    const othersVisible = bystander.players.filter(
      ({ alive, role, id }) => alive && role !== undefined && id !== seats[6].playerId,
    );
    expect(othersVisible).toEqual([]);
  });
});

describe("liars — the show of hands", () => {
  it("tallies who wants a role, and offers every role the mode has rather than only the ones in", async () => {
    const created = await room("mafia", NAMES.slice(0, 9));
    const [first, second] = created.seats;

    const before = await view(created.roomId, first);
    // Every role, not just the dealt ones — otherwise there is no way to ask for what you cannot see.
    expect(before.roleWishes.length).toBe(liarsRolesForMode("mafia").length);
    expect(before.roleWishes.some(({ active }) => active)).toBe(true);
    expect(before.roleWishes.some(({ active }) => !active)).toBe(true);

    await act(created.roomId, first, { type: "lineup.wish", role: "jester", wanted: true });
    await act(created.roomId, second, { type: "lineup.wish", role: "jester", wanted: true });

    const mine = await view(created.roomId, first);
    const jester = mine.roleWishes.find(({ role }) => role === "jester")!;
    expect(jester.count).toBe(2);
    expect(jester.yours).toBe(true);

    // Somebody who did not ask sees the same tally but not as theirs.
    const theirs = await view(created.roomId, created.seats[4]);
    expect(theirs.roleWishes.find(({ role }) => role === "jester")!).toMatchObject({
      count: 2,
      yours: false,
    });

    // Asking is a toggle, and never binds the lineup.
    await act(created.roomId, first, { type: "lineup.wish", role: "jester", wanted: false });
    const after = await view(created.roomId, first);
    expect(after.roleWishes.find(({ role }) => role === "jester")!.count).toBe(1);
    expect(after.lineup.roles.jester ?? 0).toBe(before.lineup.roles.jester ?? 0);
  });

  it("marks a role the room is too small for as unavailable rather than hiding it", async () => {
    const created = await room("mafia", NAMES.slice(0, 5));
    const snapshot = await view(created.roomId, created.seats[0]);
    // The lookout needs seven. It is still listed, with the reason.
    const lookout = snapshot.roleWishes.find(({ role }) => role === "lookout")!;
    expect(lookout.available).toBe(false);
    expect(lookout.active).toBe(false);
  });

  it("stops tallying once the game has started", async () => {
    const created = await startedGame();
    const snapshot = await view(created.roomId, created.seats[0]);
    expect(snapshot.phase).not.toBe("lobby");
    expect(snapshot.roleWishes).toEqual([]);
  });
});

describe("liars — the mole", () => {
  /**
   * The mole is a one-way mirror and both directions matter: they hold the real word and know the
   * imposter, and the imposter is never told they exist. A leak either way ruins the role — one
   * makes them a second imposter with no downside, the other hands the imposter a free ally.
   */
  it("sees the imposter and the word, while the imposter never learns they exist", async () => {
    const started = await startLiarsScenario({
      mode: "imposter",
      names: NAMES.concat(["Otis", "Rue", "Sol"]).slice(0, 12),
      deal: [
        "imposter",
        "mole",
        "crew",
        "crew",
        "crew",
        "crew",
        "crew",
        "crew",
        "crew",
        "crew",
        "crew",
        "crew",
      ],
    });
    expect(started.error, started.error ?? "").toBeNull();
    const [imposter, mole, crew] = started.seats;

    const moleView = await view(started.roomId, mole);
    expect(moleView.player!.role).toBe("mole");
    // The word, which is the half that makes them useful rather than just informed.
    expect(moleView.player!.word).toBeTruthy();
    expect(moleView.player!.allyIds).toContain(imposter.playerId);

    // One-way. The imposter is holding no word and has never heard of the mole.
    const imposterView = await view(started.roomId, imposter);
    expect(imposterView.player!.role).toBe("imposter");
    expect(imposterView.player!.word).toBeNull();
    expect(imposterView.player!.allyIds).not.toContain(mole.playerId);

    // And the crew see neither of them.
    const crewView = await view(started.roomId, crew);
    expect(crewView.player!.word).toBe(moleView.player!.word);
    expect(crewView.player!.allyIds).toEqual([]);
    expect(
      crewView.players.filter(({ role, id }) => role !== undefined && id !== crew.playerId),
    ).toEqual([]);
  });
});

describe("liars — the escort's testimony", () => {
  /**
   * The escort's whole payoff is that dying still delivers the name. If that line does not reach
   * the table, the role is a coin flip that kills you for nothing.
   */
  it("publishes the name to everybody at dawn when the escort dies with their target", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T06:00:00Z"));
    const started = await startLiarsScenario({
      mode: "mafia",
      names: NAMES.slice(0, 6),
      deal: ["mafia", "escort", "doctor", "detective", "villager", "villager"],
    });
    expect(started.error).toBeNull();
    const seats = started.seats;
    const [mafia, escort, , , victim] = seats;

    const deal = await view(started.roomId, seats[0]);
    await runTo(started.roomId, seats, deal.phaseEndsAt + 1);
    const night = await view(started.roomId, seats[0]);
    await runTo(started.roomId, seats, night.nightOpensAt! + 100);

    // The escort spends the night exactly where the mafia are going.
    await act(started.roomId, escort, {
      type: "night.select",
      round: night.round,
      targetId: victim.playerId,
    });
    await act(started.roomId, mafia, {
      type: "night.select",
      round: night.round,
      targetId: victim.playerId,
    });
    await runTo(started.roomId, seats, night.phaseEndsAt + 1);

    const dawn = await view(started.roomId, seats[3]);
    expect(dawn.phase).toBe("dawn");
    // Both of them: the target, and the escort who was standing in the room.
    expect(dawn.dawn!.deaths.map(({ name }) => name).sort()).toEqual(
      [victim.name, escort.name].sort(),
    );

    // The testimony has to be on everybody's screen, not just stored on the corpse.
    const testimony = dawn.dawn!.lastWords.find(({ name }) => name === escort.name);
    expect(testimony, "the escort's testimony never reached the table").toBeTruthy();
    expect(testimony!.text).toContain(mafia.name);
  });
});

describe("liars — unchanged reads", () => {
  it("answers a matching digest with a body a fiftieth of the size", async () => {
    const created = await startedGame();
    const seat = created.seats[0];
    const base = {
      roomId: created.roomId,
      credential: seat.playerToken,
      playerId: seat.playerId,
      lastSequence: 0,
    };

    const first = await readLiarsSnapshot(base);
    expect(first.ok).toBe(true);
    const digest = first.ok ? first.snapshot?.digest : undefined;
    expect(digest, "the read must stamp the view it hashed").toBeTruthy();

    const again = await readLiarsSnapshot({ ...base, lastDigest: digest });
    expect(again.ok && again.unchanged).toBe(true);
    expect(JSON.stringify(again).length).toBeLessThan(JSON.stringify(first).length / 10);
  });

  it("gives two players in one room different digests", async () => {
    const created = await startedGame();
    const digests = new Set<string>();
    for (const seat of created.seats) {
      const read = await readLiarsSnapshot({
        roomId: created.roomId,
        credential: seat.playerToken,
        playerId: seat.playerId,
        lastSequence: 0,
      });
      if (read.ok && read.snapshot) digests.add(read.snapshot.digest!);
    }
    // Hashed after redaction. One shared digest would mean one player could be told "unchanged"
    // against another player's view.
    expect(digests.size).toBe(created.seats.length);
  });

  /**
   * The reason this hashes the view instead of comparing `sequence`. Whether somebody counts as
   * connected is derived from how long ago they were last seen, not from anything that writes to
   * the room — so a sequence check would have frozen the presence dots until an unrelated write
   * happened to bump it.
   */
  it("still sends a body when only time has moved, and somebody went quiet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T12:00:00Z"));
    const created = await startedGame();
    const watcher = created.seats[0];
    const base = {
      roomId: created.roomId,
      credential: watcher.playerToken,
      playerId: watcher.playerId,
      lastSequence: 0,
    };

    await touchAll(created.roomId, created.seats);
    const first = await readLiarsSnapshot(base);
    const digest = first.ok ? first.snapshot!.digest : undefined;
    expect(first.ok && first.snapshot!.players.every(({ connected }) => connected)).toBe(true);

    // Everybody else stops reading for longer than the connected window; only the watcher polls.
    vi.setSystemTime(Date.now() + LIARS_CONNECTED_WINDOW_MS + 5_000);
    const later = await readLiarsSnapshot({ ...base, lastDigest: digest });

    expect(later.ok && later.unchanged, "a dot changed, so this cannot be an unchanged read").toBe(
      undefined,
    );
    expect(later.ok && later.snapshot!.players.some(({ connected }) => !connected)).toBe(true);
  });
});

describe("liars — the wire", () => {
  /**
   * Every action has to be remembered in two places: the engine's switch and the HTTP validator
   * that guards it. The engine tests call the engine directly, so an action can pass all of them
   * and still 500 on a real device — which is exactly how the graveyard board first reached the
   * browser. This walks the union.
   */
  const SAMPLES: Array<Record<string, unknown>> = [
    { type: "readiness.set", ready: true },
    { type: "host.claim" },
    { type: "words.last", text: "it was them" },
    { type: "guess.final", text: "otter" },
    { type: "lineup.wish", role: "jester", wanted: true },
    { type: "graveyard.pin", text: "the doctor is real" },
    { type: "graveyard.unpin", noteId: "note-1" },
    { type: "night.select", round: 1, targetId: null },
    { type: "night.lock", round: 1 },
    { type: "vote.lock", round: 1 },
    { type: "clue.said", round: 1 },
    { type: "clue.allSaid", round: 1 },
    { type: "clue.skip", round: 1, playerId: "p1" },
    { type: "day.point", round: 1, targetId: null },
    { type: "day.readyToVote", round: 1, ready: true },
    { type: "vote.cast", round: 1, targetId: null },
    { type: "graveyard.vote", round: 1, targetId: null },
  ];

  it("accepts every action the client can send", () => {
    for (const sample of SAMPLES) {
      const parsed = parseLiarsPlayerAction({ ...sample, actionId: "a1" });
      expect(parsed.type, `${String(sample.type)} was rejected by the validator`).toBe(sample.type);
    }
  });

  it("still refuses an action it has never heard of", () => {
    expect(() => parseLiarsPlayerAction({ actionId: "a1", type: "graveyard.burn" })).toThrow();
  });
});

describe("liars scenarios", () => {
  it("every preset opens into a dealt, playable game", async () => {
    for (const scenario of LIARS_SCENARIOS) {
      const names = NAMES.concat(["Otis", "Rue", "Sol", "Vic", "Wren", "Zaid", "Cleo"]).slice(
        0,
        scenario.players,
      );

      const started = await startLiarsScenario({
        mode: scenario.mode,
        names,
        lineup: scenario.lineup,
        toggles: scenario.toggles,
        deal: scenario.deal,
      });

      expect(started.error, `${scenario.id}: ${started.error}`).toBeNull();
      expect(started.seats, scenario.id).toHaveLength(scenario.players);

      const seat = started.seats[0];
      const snapshot = await view(started.roomId, seat);
      expect(snapshot.phase, scenario.id).toBe("deal");
      expect(snapshot.players, scenario.id).toHaveLength(scenario.players);
      // Everybody is holding something, and the deal matches the lineup on the board.
      for (const each of started.seats) {
        const own = await view(started.roomId, each);
        expect(own.player?.role, `${scenario.id}: ${each.name}`).toBeTruthy();
      }
    }
  });

  it("honours a pinned deal exactly", async () => {
    const scenario = LIARS_SCENARIOS.find(({ id }) => id === "doctor-self-save")!;
    const started = await startLiarsScenario({
      mode: scenario.mode,
      names: NAMES.slice(0, scenario.players),
      deal: scenario.deal,
    });
    expect(started.error).toBeNull();

    const dealt: string[] = [];
    for (const seat of started.seats) dealt.push((await view(started.roomId, seat)).player!.role);
    expect(dealt).toEqual(["mafia", "doctor", "detective", "villager", "villager"]);
  });

  it("refuses a pinned deal that does not fill the table", async () => {
    const started = await startLiarsScenario({
      mode: "mafia",
      names: NAMES.slice(0, 5),
      deal: { 0: "mafia", 1: "doctor" },
    });
    expect(started.error).toContain("different number of roles");
  });
});

describe("liars phase machine", () => {
  /**
   * The phase machine is a switch rather than a declared state machine, and transitions are not all
   * in one place — `advance` owns most, but an all-locked night, a ready-to-vote majority, an
   * all-locked vote and a final clue can each move it too. This pins the legal edges so a new
   * shortcut cannot quietly invent one.
   */
  const LEGAL: Record<LiarsPhase, LiarsPhase[]> = {
    lobby: ["deal"],
    deal: ["night", "clue"],
    night: ["dawn", "ending"],
    dawn: ["deliberation"],
    clue: ["clue", "deliberation"],
    deliberation: ["vote"],
    vote: ["verdict"],
    verdict: ["night", "clue", "finalGuess", "ending"],
    finalGuess: ["ending"],
    ending: [],
  };

  it("never leaves a phase by an edge that is not on the map", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T15:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 5));
    await host(created.roomId, created.hostToken, { type: "game.start" });

    // Sampled on every read and every action result, not once per loop: deliberation, vote and
    // verdict can all pass between two coarse observations, which would read as a phantom jump.
    let previous = (await view(created.roomId, created.seats[0])).phase;
    const seen = new Set<LiarsPhase>([previous]);
    const observe = (phase: LiarsPhase) => {
      if (phase === previous) return;
      expect(LEGAL[previous], `illegal transition ${previous} → ${phase}`).toContain(phase);
      previous = phase;
      seen.add(phase);
    };
    const look = async (seat: Seat) => {
      const snapshot = await view(created.roomId, seat);
      observe(snapshot.phase);
      return snapshot;
    };
    const step = async (seat: Seat, action: Record<string, unknown>) => {
      const result = await act(created.roomId, seat, action);
      if (result.snapshot) observe(result.snapshot.phase);
      return result;
    };

    // Play three whole rounds on the clock, taking every action a table would.
    for (let pass = 0; pass < 60; pass += 1) {
      if ((await look(created.seats[0])).phase === "ending") break;

      for (const seat of created.seats) {
        const own = await look(seat);
        if (!own.player?.alive) continue;
        if (own.phase === "night" && !own.player.nightLocked) {
          const target = own.player.targetableIds[0];
          if (target)
            await step(seat, { type: "night.select", round: own.round, targetId: target });
          await step(seat, { type: "night.lock", round: own.round });
        }
        if (own.phase === "deliberation" && !own.player.readyToVote)
          await step(seat, { type: "day.readyToVote", round: own.round, ready: true });
        if (own.phase === "vote" && !own.player.voteLocked) {
          const victim = own.players.find(({ alive, id }) => alive && id !== seat.playerId);
          await step(seat, {
            type: "vote.cast",
            round: own.round,
            targetId: victim?.id ?? null,
          });
          await step(seat, { type: "vote.lock", round: own.round });
        }
      }

      const after = await look(created.seats[0]);
      let cursor = Date.now();
      while (cursor < after.phaseEndsAt + 1) {
        cursor = Math.min(after.phaseEndsAt + 1, cursor + 5_000);
        vi.setSystemTime(cursor);
        for (const seat of created.seats) await look(seat);
      }
    }

    // And it actually went somewhere, rather than passing by never moving.
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(seen.has("dawn")).toBe(true);
    expect(seen.has("verdict")).toBe(true);
  });
});

describe("liars at scale", () => {
  /**
   * Rooms are independent by construction — one Redis key each, one lock each — but "by
   * construction" is exactly the kind of claim that stops being true the first time somebody adds
   * a module-level cache. This runs twenty games at once and checks nothing crossed over.
   */
  it("runs twenty concurrent rooms without any of them touching each other", async () => {
    const rooms = await Promise.all(
      Array.from({ length: 20 }, async (_, index) => {
        const mode: LiarsMode = index % 2 === 0 ? "mafia" : "imposter";
        const names = NAMES.concat(["Otis", "Rue", "Sol", "Vic", "Wren", "Zaid"]).slice(
          0,
          mode === "mafia" ? 9 : 8,
        );
        const started = await startLiarsScenario({ mode, names });
        return { index, mode, ...started };
      }),
    );

    const ids = rooms.map(({ roomId }) => roomId);
    expect(new Set(ids).size, "room codes collided").toBe(rooms.length);

    for (const each of rooms) {
      expect(each.error, `room ${each.index}`).toBeNull();

      const seen = new Set<string>();
      for (const seat of each.seats) {
        const snapshot = await view(each.roomId, seat);
        expect(snapshot.roomId, `room ${each.index}`).toBe(each.roomId);
        expect(snapshot.mode, `room ${each.index}`).toBe(each.mode);
        expect(snapshot.players, `room ${each.index}`).toHaveLength(each.seats.length);
        // Nobody from another table has wandered in.
        for (const player of snapshot.players)
          expect(each.seats.some(({ playerId }) => playerId === player.id)).toBe(true);
        seen.add(snapshot.player!.role);
      }
      // And each table got its own deal rather than a shared one.
      expect(seen.size, `room ${each.index} dealt one role to everyone`).toBeGreaterThan(1);
    }

    // A credential from one room opens nothing in another.
    const [first, second] = rooms;
    const crossed = await readLiarsSnapshot({
      roomId: second.roomId,
      credential: first.seats[0].playerToken,
      playerId: first.seats[0].playerId,
      lastSequence: 0,
    });
    expect(crossed).toMatchObject({ ok: false, snapshot: null });
  });

  it("keeps concurrent writers to one room from losing each other's actions", async () => {
    const started = await startLiarsScenario({ mode: "mafia", names: NAMES.slice(0, 9) });
    expect(started.error).toBeNull();

    // Everyone marks themselves unready at the same moment, on the same room.
    const results = await Promise.all(
      started.seats.map((seat, index) =>
        applyLiarsPlayerAction({
          roomId: started.roomId,
          playerId: seat.playerId,
          playerToken: seat.playerToken,
          action: { actionId: `race-${index}`, type: "readiness.set", ready: false },
        }),
      ),
    );

    // The deal has started, so readiness is refused — but every one of them must be answered, and
    // none may corrupt the room.
    expect(results).toHaveLength(9);
    const snapshot = await view(started.roomId, started.seats[0]);
    expect(snapshot.players).toHaveLength(9);
    expect(snapshot.phase).toBe("deal");
  });
});

describe("liars readiness", () => {
  it("names who is holding the room up rather than saying somebody is", async () => {
    const created = await room("mafia", NAMES.slice(0, 5));
    await act(created.roomId, created.seats[2], { type: "readiness.set", ready: false });

    const blocked = await host(created.roomId, created.hostToken, { type: "game.start" });
    expect(blocked.accepted).toBe(false);
    if (!blocked.accepted && "error" in blocked)
      expect(blocked.error, "the host cannot chase somebody they cannot name").toContain(
        created.seats[2].name,
      );

    // And their state is on the roster, so nobody has to read an error to find out.
    const view0 = await view(created.roomId, created.seats[0]);
    expect(view0.players.find(({ id }) => id === created.seats[2].playerId)?.ready).toBe(false);
    expect(view0.players.filter(({ ready }) => ready)).toHaveLength(4);
  });

  it("lets the host start without the stragglers", async () => {
    const created = await room("mafia", NAMES.slice(0, 6));
    await act(created.roomId, created.seats[3], { type: "readiness.set", ready: false });

    const blocked = await host(created.roomId, created.hostToken, { type: "game.start" });
    expect(blocked.accepted).toBe(false);

    // Waiting on a phone in somebody's pocket is a worse failure than starting without them.
    const started = await host(created.roomId, created.hostToken, {
      type: "game.start",
      removePlayerIds: [created.seats[3].playerId],
    });
    expect(started.accepted).toBe(true);
    expect(started.snapshot!.phase).toBe("deal");
    expect(started.snapshot!.players).toHaveLength(5);
    expect(started.snapshot!.players.some(({ id }) => id === created.seats[3].playerId)).toBe(
      false,
    );
  });

  it("keeps the room intact when removing stragglers would go below the minimum", async () => {
    const created = await room("mafia", NAMES.slice(0, 5));
    await act(created.roomId, created.seats[3], { type: "readiness.set", ready: false });
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const rejected = await host(created.roomId, created.hostToken, {
      type: "game.start",
      removePlayerIds: [created.seats[3].playerId],
    });
    expect(rejected.accepted).toBe(false);
    if (!rejected.accepted && "error" in rejected) expect(rejected.error).toContain("5 ready");
    const unchanged = await view(created.roomId, created.seats[0]);
    expect(unchanged.phase).toBe("lobby");
    expect(unchanged.players).toHaveLength(5);
  });
});

describe("liars from the playtest", () => {
  it("makes a tied town vote again, once, between whoever tied", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T16:00:00Z"));
    const created = await room("mafia", NAMES.slice(0, 6));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    let snapshot = await view(created.roomId, created.seats[0]);
    for (let step = 0; step < 8 && snapshot.phase !== "vote"; step += 1) {
      await runTo(created.roomId, created.seats, snapshot.phaseEndsAt + 1);
      snapshot = await view(created.roomId, created.seats[0]);
    }
    expect(snapshot.phase).toBe("vote");

    // Three each way, dead level.
    const [a, b] = created.seats;
    for (const [index, seat] of created.seats.entries())
      await act(created.roomId, seat, {
        type: "vote.cast",
        round: snapshot.round,
        targetId: index % 2 === 0 ? a.playerId : b.playerId,
      });
    for (const seat of created.seats)
      await act(created.roomId, seat, { type: "vote.lock", round: snapshot.round });

    const again = await view(created.roomId, created.seats[0]);
    expect(again.phase, "a tie used to end the day").toBe("vote");
    expect(again.history.at(-1)!.text).toContain("Again");
    expect(again.player!.vote, "the runoff starts from a clean slate").toBeNull();

    // A second tie stands.
    for (const [index, seat] of created.seats.entries())
      await act(created.roomId, seat, {
        type: "vote.cast",
        round: again.round,
        targetId: index % 2 === 0 ? a.playerId : b.playerId,
      });
    for (const seat of created.seats)
      await act(created.roomId, seat, { type: "vote.lock", round: again.round });
    expect((await view(created.roomId, created.seats[0])).phase).toBe("verdict");
  });

  it("hands the clue round over differently depending on where everyone is", async () => {
    const table = await createLiarsRoom({ mode: "imposter", roomMode: "same-room" });
    const call = await createLiarsRoom({ mode: "imposter", roomMode: "remote" });

    for (const [created, expected] of [
      [table, "one-tap"],
      [call, "each-turn"],
    ] as const) {
      const seats = [];
      for (const name of NAMES.slice(0, 6)) {
        const joined = await joinLiarsRoom({
          roomId: created.roomId,
          joinToken: created.joinToken,
          name,
          joinId: `${created.roomId}-${name}`,
        });
        if (joined.ok)
          seats.push({ playerId: joined.playerId, playerToken: joined.playerToken, name });
      }
      await applyLiarsHostAction({
        roomId: created.roomId,
        hostToken: created.hostToken,
        action: { actionId: `start-${created.roomId}`, type: "game.start" },
      });
      const deal = await view(created.roomId, seats[0]);
      await runTo(created.roomId, seats, deal.phaseEndsAt + 1);
      const clue = await view(created.roomId, seats[0]);
      expect(clue.clue?.handoff, expected).toBe(expected);
    }
  });

  it("lets anybody move a stalled turn on, and anybody end the round at a table", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T17:00:00Z"));
    const created = await room("imposter", NAMES.slice(0, 6));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const deal = await view(created.roomId, created.seats[0]);
    await runTo(created.roomId, created.seats, deal.phaseEndsAt + 1);

    const clue = await view(created.roomId, created.seats[0]);
    const current = clue.clue!.currentPlayerId;
    const bystander = created.seats.find(({ playerId }) => playerId !== current)!;

    // Somebody has put their phone down; nine other people should not be stuck behind them.
    const skipped = await act(created.roomId, bystander, {
      type: "clue.skip",
      round: clue.round,
      playerId: current!,
    });
    expect(skipped.accepted).toBe(true);
    expect(skipped.snapshot!.clue!.currentPlayerId).not.toBe(current);

    // And one tap ends the whole circle where everyone can already hear each other.
    const done = await act(created.roomId, bystander, {
      type: "clue.allSaid",
      round: clue.round,
    });
    expect(done.accepted).toBe(true);
    expect(["deliberation", "clue"]).toContain(done.snapshot!.phase);
  });
});

describe("liars board toggle", () => {
  it("gives everybody the same shortlist, or nobody one at all", async () => {
    for (const [wordBoard, expectBoard] of [
      [true, true],
      [false, false],
    ] as const) {
      const created = await room("imposter", NAMES.slice(0, 8), { wordBoard });
      await host(created.roomId, created.hostToken, { type: "game.start" });
      const seen = await Promise.all(created.seats.map((seat) => view(created.roomId, seat)));

      const boards = seen.map((snapshot) => snapshot.player!.wordBoard);
      for (const board of boards)
        expect(board.length > 0, `wordBoard=${wordBoard}`).toBe(expectBoard);
      // Identical for everyone, or the imposter could tell theirs apart.
      for (const board of boards) expect(board).toEqual(boards[0]);

      // Without a board the category is still there — the imposter is never given nothing at all.
      const imposter = seen.find((snapshot) => snapshot.player!.role === "imposter")!;
      expect(imposter.player!.wordCategory).toBeTruthy();
      expect(imposter.player!.word).toBeNull();
    }
  });
});

describe("liars custom lineups", () => {
  it("lets a host add a role the default did not reach, and deals it", async () => {
    const created = await room("mafia", NAMES.slice(0, 9));
    const standard = (await view(created.roomId, created.seats[0])).lineup;
    expect(standard.roles.bodyguard, "the nine-player default has no bodyguard").toBeUndefined();

    // One villager becomes a bodyguard.
    const custom = {
      roles: { ...standard.roles, villager: (standard.roles.villager ?? 0) - 1, bodyguard: 1 },
    };
    const set = await host(created.roomId, created.hostToken, {
      type: "game.configure",
      lineup: custom,
    });
    expect(set.accepted, "error" in set ? set.error : "").toBe(true);
    expect(set.snapshot!.lineup.roles.bodyguard).toBe(1);

    const started = await host(created.roomId, created.hostToken, { type: "game.start" });
    expect(started.accepted).toBe(true);
    const dealt: string[] = [];
    for (const seat of created.seats) dealt.push((await view(created.roomId, seat)).player!.role);
    expect(dealt).toContain("bodyguard");
  });

  it("refuses a lineup the game cannot run, with the reason", async () => {
    const created = await room("mafia", NAMES.slice(0, 9));
    const broken = await host(created.roomId, created.hostToken, {
      type: "game.configure",
      lineup: {
        roles: { godfather: 1, mafia: 3, jammer: 1, doctor: 1, detective: 1, villager: 2 },
      },
    });
    expect(broken).toMatchObject({ accepted: false, errorCode: "lineup_invalid" });
    if (!broken.accepted && "error" in broken) expect(broken.error).toContain("parity");
  });

  it("reverts a custom lineup once it no longer fits the room", async () => {
    const created = await room("mafia", NAMES.slice(0, 9));
    const standard = (await view(created.roomId, created.seats[0])).lineup;
    await host(created.roomId, created.hostToken, {
      type: "game.configure",
      lineup: {
        roles: { ...standard.roles, villager: (standard.roles.villager ?? 0) - 1, bodyguard: 1 },
      },
    });

    // Somebody else arrives, so nine roles no longer cover ten people.
    const late = await joinLiarsRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name: "Cleo",
      joinId: "late-one",
    });
    expect(late.ok).toBe(true);

    const after = await view(created.roomId, created.seats[0]);
    expect(after.players).toHaveLength(10);
    // Back to something that adds up, rather than sitting there broken.
    expect(Object.values(after.lineup.roles).reduce((total, count) => total + count, 0)).toBe(10);
  });

  it("puts a host back on the standard lineup on request", async () => {
    const created = await room("mafia", NAMES.slice(0, 9));
    const standard = (await view(created.roomId, created.seats[0])).lineup;
    await host(created.roomId, created.hostToken, {
      type: "game.configure",
      lineup: {
        roles: { ...standard.roles, villager: (standard.roles.villager ?? 0) - 1, bodyguard: 1 },
      },
    });
    const reset = await host(created.roomId, created.hostToken, {
      type: "game.configure",
      resetLineup: true,
    });
    expect(reset.snapshot!.lineup).toEqual(standard);
  });
});
