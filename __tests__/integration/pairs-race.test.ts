import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";
import {
  commandPairsRace,
  createPairsRace,
  joinPairsRace,
  readPairsRace,
} from "@/features/things/pairs/pairs-race.server";
import type { PairsRaceIdentity } from "@/features/things/pairs/pairs-race.server";
import type { PairsRace, PairsRaceAction } from "@/features/things/pairs/pairs-race-rules";
import { readPostgresRoom } from "@/features/things/shared/room-postgres.server";
import {
  capturePairsRace,
  PAIRS_RACE_SCENARIOS,
  restorePairsRaceCapture,
  startPairsRaceScenario,
} from "@/features/things/pairs/pairs-race-dev.server";

describeWithDatabase("Pairs race authority and recovery", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(async () => {
    await query("truncate multiplayer_room_action_receipts, multiplayer_rooms cascade");
  });
  const send = (seat: PairsRaceIdentity, action: PairsRaceAction, now = Date.now()) =>
    commandPairsRace(
      {
        roomId: seat.roomId,
        playerId: seat.playerId,
        playerToken: seat.playerToken,
        actionId: randomUUID(),
        action,
      },
      { now, seed: 404 },
    );
  async function table() {
    const host = await createPairsRace({ name: "Alex", pairCount: 3 });
    const guest = await joinPairsRace({
      roomId: host.roomId,
      name: "Jo",
      playerId: randomUUID(),
      playerToken: randomUUID(),
    });
    return [host, guest];
  }
  async function begin(seats: PairsRaceIdentity[]) {
    for (const seat of seats) await send(seat, { type: "ready", ready: true });
    await send(seats[0], { type: "begin" }, Date.now() - 5000);
  }
  async function fill(seat: PairsRaceIdentity, pairs = 3) {
    const room = (await readPostgresRoom<PairsRace>("pairs-race", seat.roomId))!.state;
    const game = room.players.find((player) => player.id === seat.playerId)!.game!;
    let now = Date.now();
    const ranks = [...new Set(game.cards.map((card) => card.rank))].slice(0, pairs);
    for (const rank of ranks) {
      for (const [index, card] of game.cards.entries()) {
        if (card.rank === rank)
          expect((await send(seat, { type: "flip", index, round: room.round }, now)).accepted).toBe(
            true,
          );
      }
      now += 2000;
    }
    return now;
  }

  it("keeps joins idempotent, rejects a third player, and never exposes hidden faces or credentials", async () => {
    const [host, guest] = await table();
    const repeated = await joinPairsRace({ ...guest, name: "Jo" });
    expect(repeated.playerId).toBe(guest.playerId);
    await expect(
      joinPairsRace({
        roomId: host.roomId,
        name: "Extra",
        playerId: randomUUID(),
        playerToken: randomUUID(),
      }),
    ).rejects.toThrow("two players");
    expect(await readPairsRace({ ...host, playerToken: "wrong" })).toBeNull();
    expect((await send(host, { type: "begin" })).accepted).toBe(false);
    await begin([host, guest]);
    const a = (await readPairsRace(host))!;
    const b = (await readPairsRace(guest))!;
    expect(a.game?.cards.every((card) => card.rank === "")).toBe(true);
    expect(b.game?.cards.every((card) => card.rank === "")).toBe(true);
    expect(JSON.stringify(a)).not.toMatch(/tokenHash|playerToken|seed|unlockAt/);
    await send(host, { type: "flip", index: 0, round: 1 });
    expect((await readPairsRace(host))!.game?.cards[0].rank).not.toBe("");
    expect((await readPairsRace(guest))!.game?.cards[0].rank).toBe("");
  });

  it("uses the same shuffle for both racers, enforces the countdown and reveal, and replays duplicate moves", async () => {
    const [host, guest] = await table();
    for (const seat of [host, guest]) await send(seat, { type: "ready", ready: true });
    const now = Date.now();
    await send(host, { type: "begin" }, now);
    expect((await send(host, { type: "flip", index: 0, round: 1 }, now)).accepted).toBe(false);
    const room = (await readPostgresRoom<PairsRace>("pairs-race", host.roomId))!.state;
    expect(room.players[0].game?.cards).toEqual(room.players[1].game?.cards);
    const request = {
      roomId: host.roomId,
      playerId: host.playerId,
      playerToken: host.playerToken,
      actionId: randomUUID(),
      action: { type: "flip", index: 0, round: 1 } as const,
    };
    const [a, b] = await Promise.all([
      commandPairsRace(request, { now: now + 4000, seed: 404 }),
      commandPairsRace(request, { now: now + 4000, seed: 404 }),
    ]);
    expect(a).toEqual(b);
    const partner = room.players[0].game!.cards.findIndex(
      (card, index) => index !== 0 && card.rank === room.players[0].game!.cards[0].rank,
    );
    await send(host, { type: "flip", index: partner, round: 1 }, now + 4000);
    const other = room.players[0].game!.cards.findIndex(
      (card) => card.rank !== room.players[0].game!.cards[0].rank,
    );
    expect((await send(host, { type: "flip", index: other, round: 1 }, now + 4001)).accepted).toBe(
      false,
    );
  });

  it("arbitrates simultaneous last pairs once, carries round wins, rejects stale rounds, and rematches", async () => {
    const seats = await table();
    await begin(seats);
    const now = Math.max(...(await Promise.all(seats.map((seat) => fill(seat, 2))))) + 2000;
    const room = (await readPostgresRoom<PairsRace>("pairs-race", seats[0].roomId))!.state;
    const last: number[] = [];
    room.players[0].game!.cards.forEach((_, index) => {
      if (!room.players[0].game!.matched.includes(index)) last.push(index);
    });
    for (const seat of seats) await send(seat, { type: "flip", index: last[0], round: 1 }, now);
    const finishes = await Promise.all(
      seats.map((seat) => send(seat, { type: "flip", index: last[1], round: 1 }, now)),
    );
    expect(finishes.filter((finish) => finish.accepted)).toHaveLength(1);
    const winner = finishes[0].accepted ? seats[0] : seats[1];
    let view = (await readPairsRace(winner))!;
    expect(view.phase).toBe("reveal");
    expect(view.players.reduce((sum, player) => sum + player.wins, 0)).toBe(1);
    await begin(seats);
    expect((await send(winner, { type: "flip", index: 0, round: 1 })).accepted).toBe(false);
    await fill(winner);
    view = (await readPairsRace(winner))!;
    expect(view).toMatchObject({ phase: "finished", round: 2, winnerId: winner.playerId });
    await begin(seats);
    view = (await readPairsRace(winner))!;
    expect(view).toMatchObject({ phase: "playing", round: 1, winnerId: null });
    expect(view.players.map((player) => player.wins)).toEqual([0, 0]);
  });

  it("supports concession without requiring the missing device", async () => {
    const seats = await table();
    await begin(seats);
    expect((await send(seats[0], { type: "concede" })).accepted).toBe(true);
    expect(await readPairsRace(seats[1])).toMatchObject({
      phase: "finished",
      winnerId: seats[1].playerId,
      conceded: true,
    });
  });

  it("opens every guarded development scenario and restores a signed capture under fresh identities", async () => {
    for (const scenario of PAIRS_RACE_SCENARIOS) {
      const seats = await startPairsRaceScenario(scenario);
      const snapshot = await readPairsRace(seats[0]);
      expect(snapshot?.phase).toBe(
        scenario === "lobby"
          ? "lobby"
          : scenario === "live race"
            ? "playing"
            : scenario === "round reveal"
              ? "reveal"
              : "finished",
      );
      const capture = await capturePairsRace(seats[0]);
      const restored = await restorePairsRaceCapture(capture);
      expect(restored[0].roomId).not.toBe(seats[0].roomId);
      expect(restored[0].playerToken).not.toBe(seats[0].playerToken);
      expect((await readPairsRace(restored[0]))?.phase).toBe(snapshot?.phase);
      expect(await readPairsRace(seats[0])).not.toBeNull();
      const tampered = JSON.parse(capture);
      tampered.payload += " ";
      await expect(restorePairsRaceCapture(JSON.stringify(tampered))).rejects.toThrow("invalid");
    }
  });
});
