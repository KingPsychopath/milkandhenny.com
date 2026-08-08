import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  applyTwinAction,
  createTwinRoom,
  joinTwinRoom,
  readTwinLog,
  readTwinSnapshot,
} from "../../features/things/twin/twin-room.server";
import { TWIN_TIMING } from "../../features/things/twin/twin-rules";
import type { TwinSnapshot } from "../../features/things/twin/types";

afterEach(() => vi.useRealTimers());

interface Seat {
  name: string;
  roomId: string;
  playerId: string;
  playerToken: string;
}

async function openRoom(names: string[], handSize = 4) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
  const created = await createTwinRoom({ hostName: names[0], handSize });
  const seats: Seat[] = [
    {
      name: names[0],
      roomId: created.roomId,
      playerId: created.playerId,
      playerToken: created.playerToken,
    },
  ];
  for (const name of names.slice(1)) {
    const joined = await joinTwinRoom({
      roomId: created.roomId,
      joinToken: created.joinToken,
      name,
    });
    if (!joined.ok) throw new Error(`${name}: ${joined.error}`);
    seats.push({
      name,
      roomId: created.roomId,
      playerId: joined.playerId,
      playerToken: joined.playerToken,
    });
  }
  return { roomId: created.roomId, seats };
}

function look(seat: Seat) {
  return readTwinSnapshot(seat).then((result) => {
    if (!result.ok) throw new Error(result.error);
    return result.snapshot;
  });
}

/** Move the clock and let a read drive the state machine, exactly as a poll would. */
async function tick(seat: Seat, ms: number) {
  vi.setSystemTime(Date.now() + ms);
  return look(seat);
}

function sharedSymbols(a: { symbolIds: string[] }, b: { symbolIds: string[] }) {
  return a.symbolIds.filter((id) => b.symbolIds.includes(id));
}

/**
 * The guarantee, checked from the snapshots the clients actually receive rather than from the deck.
 *
 * This is the assertion the whole game rests on: if a player's card and the middle card ever failed to
 * share exactly one symbol, the heat would be unwinnable and it would look like a UI bug rather than
 * the deck being wrong.
 */
async function everyoneCanPlay(seats: Seat[]) {
  const snapshots = await Promise.all(seats.map(look));
  const dealt: string[] = [];
  for (const snapshot of snapshots) {
    const middle = snapshot.heat?.middle;
    const top = snapshot.player?.top;
    if (!middle || !top) continue;
    expect(sharedSymbols(top, middle)).toHaveLength(1);
    dealt.push(top.cardId, ...(snapshot.player?.rest ?? []).map(({ cardId }) => cardId));
  }
  // Two identical cards share every symbol, so the answer would stop being checkable.
  expect(new Set(dealt).size).toBe(dealt.length);
  const middles = new Set(snapshots.map((snapshot) => snapshot.heat?.middle.cardId));
  expect(middles.size).toBe(1);
  expect(dealt).not.toContain([...middles][0]);
  return snapshots;
}

async function answer(seat: Seat, snapshot: TwinSnapshot, elapsedMs: number, correct = true) {
  const middle = snapshot.heat?.middle;
  const top = snapshot.player?.top;
  if (!middle || !top || !snapshot.heat) throw new Error("nothing to answer");
  const [match] = sharedSymbols(top, middle);
  const symbolId = correct ? match : (top.symbolIds.find((id) => id !== match) ?? match);
  return applyTwinAction({
    ...seat,
    action: { type: "answer.tap", heatId: snapshot.heat.id, symbolId, elapsedMs },
  });
}

async function startGame(seats: Seat[]) {
  const started = await applyTwinAction({ ...seats[0], action: { type: "game.start" } });
  expect(started.accepted).toBe(true);
  // Past the deal, into the first heat…
  await tick(seats[0], TWIN_TIMING.dealingMs + 100);
  // …and past the short lead-in before the cards are live, or every tap is refused as too early.
  return tick(seats[0], 300);
}

describe("Twin rooms", () => {
  it("always leaves every player exactly one symbol to find, every heat of a whole game", async () => {
    const { seats } = await openRoom(["Abel", "Maya", "Daniel", "Priya"], 4);
    await startGame(seats);

    let guard = 0;
    let finished = false;
    const heatsSeen = new Set<number>();

    while (!finished && guard < 60) {
      guard += 1;
      const snapshots = await everyoneCanPlay(seats);
      const live = snapshots[0];
      if (live.phase === "finished") {
        finished = true;
        break;
      }
      if (live.phase === "heat") {
        heatsSeen.add(live.heat?.number ?? 0);
        // A different pair each heat: some land it, one is always slower, one sits out.
        for (const [index, seat] of seats.entries()) {
          if (index === seats.length - 1) continue;
          const snapshot = snapshots[index];
          if (snapshot.player?.top) await answer(seat, snapshot, 900 + index * 400);
        }
      }
      await tick(seats[0], 900);
    }

    expect(finished).toBe(true);
    expect(heatsSeen.size).toBeGreaterThan(1);

    const ended = await look(seats[0]);
    expect(ended.ending).not.toBeNull();
    expect(ended.players.some((player) => player.cardsLeft === 0)).toBe(true);
    // The player who never answered still holds everything they were dealt.
    expect(ended.players.at(-1)?.cardsLeft).toBe(ended.handSize);
  });

  it("burns a heat nobody wins, keeps the middle card, and turns every hand over", async () => {
    const { seats } = await openRoom(["Abel", "Maya"], 4);
    const opening = await startGame(seats);
    const middleBefore = opening.heat?.middle.cardId;
    const before = await Promise.all(seats.map(look));
    const topsBefore = before.map((snapshot) => snapshot.player?.top?.cardId);

    // Nobody answers. Past the deadline closes the heat…
    await tick(seats[0], TWIN_TIMING.defaultWindowMs + 200);
    // …and the payout lands a beat later, which is the window a late-delivered tap still counts in.
    await tick(seats[0], TWIN_TIMING.settleDelayMs + 100);
    const settled = await look(seats[0]);

    expect(settled.phase).toBe("settle");
    expect(settled.heat?.burned).toBe(true);
    expect(settled.heat?.middle.cardId).toBe(middleBefore);

    const after = await Promise.all(seats.map(look));
    for (const [index, snapshot] of after.entries())
      expect(snapshot.player?.top?.cardId).not.toBe(topsBefore[index]);

    // And the new pairing is still playable — the point of rotating rather than stalling.
    await everyoneCanPlay(seats);
  });

  it("sheds for everyone who landed it and gives the middle to the fastest", async () => {
    const { seats } = await openRoom(["Abel", "Maya", "Daniel"], 5);
    await startGame(seats);
    const snapshots = await Promise.all(seats.map(look));
    const fastestCard = snapshots[1].player?.top?.cardId;

    await answer(seats[1], snapshots[1], 800);
    await answer(seats[0], snapshots[0], 2_000);
    // Daniel never answers.

    // First blood started the grace; it expiring closes the heat, and the payout lands a beat later.
    await tick(seats[0], TWIN_TIMING.defaultGraceMs + 200);
    await tick(seats[0], TWIN_TIMING.settleDelayMs + 100);
    const settled = await look(seats[0]);

    expect(settled.phase).toBe("settle");
    expect(settled.heat?.burned).toBe(false);
    expect(settled.heat?.results.find(({ name }) => name === "Maya")?.won).toBe(true);
    expect(settled.heat?.results.find(({ name }) => name === "Abel")?.shed).toBe(true);
    expect(settled.heat?.results.find(({ name }) => name === "Daniel")?.shed).toBe(false);
    // The fastest player's card is the one everyone now plays against.
    expect(settled.heat?.middle.cardId).toBe(fastestCard);

    const players = settled.players;
    expect(players.find(({ name }) => name === "Daniel")?.cardsLeft).toBe(settled.handSize);
    expect(players.find(({ name }) => name === "Maya")?.cardsLeft).toBe(settled.handSize - 1);
  });

  it("rejects a wrong tap with a cooldown rather than a shed", async () => {
    const { seats } = await openRoom(["Abel", "Maya"], 4);
    await startGame(seats);
    const snapshot = await look(seats[0]);

    const wrong = await answer(seats[0], snapshot, 700, false);
    expect(wrong.accepted).toBe(false);
    expect(wrong.ok && wrong.accepted === false ? wrong.errorCode : null).toBe("wrong_symbol");
    expect(wrong.snapshot?.player?.misses).toBe(1);
    expect(wrong.snapshot?.player?.cooldownUntil).toBeGreaterThan(Date.now());
    expect(wrong.snapshot?.player?.landedMs).toBeNull();

    // And a second tap inside the cooldown is refused outright.
    const during = await answer(seats[0], snapshot, 750);
    expect(during.ok && during.accepted === false ? during.errorCode : null).toBe("cooling_down");
  });

  it("keeps the deck whole across a rematch", async () => {
    const { seats } = await openRoom(["Abel", "Maya"], 3);
    await startGame(seats);

    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const snapshots = await Promise.all(seats.map(look));
      if (snapshots[0].phase === "finished") break;
      if (snapshots[0].phase === "heat")
        for (const [index, seat] of seats.entries())
          if (snapshots[index].player?.top) await answer(seat, snapshots[index], 900 + index * 300);
      await tick(seats[0], 900);
    }
    expect((await look(seats[0])).phase).toBe("finished");

    const replayed = await applyTwinAction({ ...seats[0], action: { type: "game.replay" } });
    expect(replayed.accepted).toBe(true);
    expect(replayed.snapshot?.players.map(({ id }) => id)).toEqual(
      seats.map(({ playerId }) => playerId),
    );
    await tick(seats[0], TWIN_TIMING.dealingMs + 200);

    const fresh = await look(seats[0]);
    expect(fresh.gameNumber).toBe(2);
    expect(fresh.players.every(({ cardsLeft }) => cardsLeft === fresh.handSize)).toBe(true);
    expect(
      fresh.players.every(({ connections, place }) => connections === 0 && place === null),
    ).toBe(true);
    await everyoneCanPlay(seats);
  });

  it("returns the same group to the lobby and requires everyone to ready again", async () => {
    const { seats } = await openRoom(["Abel", "Maya", "Daniel"], 3);
    await startGame(seats);

    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const snapshots = await Promise.all(seats.map(look));
      if (snapshots[0].phase === "finished") break;
      if (snapshots[0].phase === "heat")
        for (const [index, seat] of seats.entries())
          if (snapshots[index].player?.top) await answer(seat, snapshots[index], 800 + index * 200);
      await tick(seats[0], 900);
    }

    const lobby = await applyTwinAction({ ...seats[0], action: { type: "game.lobby" } });
    expect(lobby.accepted).toBe(true);
    expect(lobby.snapshot?.phase).toBe("lobby");
    expect(lobby.snapshot?.players.map(({ id }) => id)).toEqual(
      seats.map(({ playerId }) => playerId),
    );
    expect(lobby.snapshot?.players.map(({ ready }) => ready)).toEqual([true, false, false]);

    const tooSoon = await applyTwinAction({ ...seats[0], action: { type: "game.start" } });
    expect(tooSoon.accepted).toBe(false);
    expect(tooSoon.ok && !tooSoon.accepted ? tooSoon.errorCode : null).toBe("players_not_ready");
    expect(tooSoon.snapshot?.players.slice(1).every(({ ready }) => !ready)).toBe(true);

    for (const seat of seats.slice(1)) {
      const ready = await applyTwinAction({
        ...seat,
        action: { type: "readiness.set", ready: true },
      });
      expect(ready.accepted).toBe(true);
    }
    const restarted = await applyTwinAction({ ...seats[0], action: { type: "game.start" } });
    expect(restarted.accepted).toBe(true);
    expect(restarted.snapshot?.phase).toBe("dealing");
    expect(restarted.snapshot?.players.every(({ ready }) => ready)).toBe(true);
  });

  it("never shows another player's hand", async () => {
    const { seats } = await openRoom(["Abel", "Maya"], 4);
    await startGame(seats);
    const [mine, theirs] = await Promise.all(seats.map(look));

    expect(mine.player?.playerId).toBe(seats[0].playerId);
    expect(theirs.player?.playerId).toBe(seats[1].playerId);
    expect(mine.player?.top?.cardId).not.toBe(theirs.player?.top?.cardId);
    // Everything about other players is a count, never a card.
    expect(JSON.stringify(mine.players)).not.toContain("symbolIds");
  });

  it("keeps the heat log out of the snapshot and serves it once at the end", async () => {
    const { seats } = await openRoom(["Abel", "Maya"], 3);
    await startGame(seats);

    const playing = await look(seats[0]);
    expect(JSON.stringify(playing)).not.toContain("missedBy");

    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const snapshots = await Promise.all(seats.map(look));
      if (snapshots[0].phase === "finished") break;
      if (snapshots[0].phase === "heat")
        for (const [index, seat] of seats.entries())
          if (snapshots[index].player?.top) await answer(seat, snapshots[index], 800 + index * 300);
      await tick(seats[0], 900);
    }

    const log = await readTwinLog(seats[0]);
    expect(log.ok).toBe(true);
    if (!log.ok) return;
    expect(log.heats.length).toBeGreaterThan(0);
    for (const heat of log.heats) {
      expect(heat.middle.symbolIds.length).toBeGreaterThan(0);
      // Every logged connection names the symbol that actually joined the two cards.
      for (const connection of heat.connections)
        expect(sharedSymbols(connection.card, heat.middle)).toEqual([connection.symbolId]);
    }
  });

  it("refuses a stranger's credentials", async () => {
    const { seats } = await openRoom(["Abel", "Maya"], 4);
    const forged = await readTwinSnapshot({
      roomId: seats[0].roomId,
      playerId: seats[0].playerId,
      playerToken: "not-the-token",
    });
    expect(forged.ok).toBe(false);
  });
});
