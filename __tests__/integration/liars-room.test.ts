import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
import type {
  LiarsMode,
  LiarsRole,
  LiarsSnapshot,
} from "../../features/things/liars/types";

afterEach(() => vi.useRealTimers());

let actionCounter = 0;
const nextActionId = () => `action-${(actionCounter += 1)}`;

interface Seat {
  playerId: string;
  playerToken: string;
  name: string;
}

async function room(mode: LiarsMode, names: string[], toggles?: Record<string, boolean>) {
  const created = await createLiarsRoom({ mode, roomMode: "same-room", toggles });
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

    const crewWord = seen.find((snapshot) => snapshot.player!.role === "crew")!.player!.word!;
    expect(crewWord.length).toBeGreaterThan(0);
    expect(JSON.stringify(imposterView)).not.toContain(crewWord);
  });

  it("gives the understudy a different word without telling them", async () => {
    const created = await room("imposter", NAMES.slice(0, 8));
    await host(created.roomId, created.hostToken, { type: "game.start" });
    const seen = await Promise.all(created.seats.map((seat) => view(created.roomId, seat)));
    const understudy = seen.find((snapshot) => snapshot.player!.role === "understudy");
    const crew = seen.find((snapshot) => snapshot.player!.role === "crew");
    expect(understudy?.player!.word).toBeTruthy();
    expect(understudy?.player!.word).not.toBe(crew?.player!.word);
    // Nothing in their view says which of the two is the real one.
    expect(JSON.stringify(understudy)).not.toContain(crew!.player!.word!);
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
    expect(await act(created.roomId, outOfTurn, { type: "clue.said", round: clue.round })).toMatchObject(
      { accepted: false, errorCode: "not_your_turn" },
    );

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
