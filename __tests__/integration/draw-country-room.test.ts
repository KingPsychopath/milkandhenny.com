import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  applyDrawCountryAction,
  createDrawCountryRoom,
  joinDrawCountryRoom,
  readDrawCountrySnapshot,
} from "../../features/things/draw-country/draw-country-room.server";
import { countryById } from "../../features/things/draw-country/countries";
import type { CountryDrawing } from "../../features/things/draw-country/types";

afterEach(() => vi.useRealTimers());

async function hostedRoom(roundTotal = 2, drawSeconds = 30) {
  return createDrawCountryRoom({
    hostName: "Abel",
    drawSeconds,
    roundTotal,
    recentCountryIds: [],
  });
}

async function joined(roomId: string, joinToken: string, name: string) {
  const result = await joinDrawCountryRoom({ roomId, joinToken, name });
  if (!result.ok) throw new Error(result.error);
  return result;
}

/** An exact trace of the round's country, placed on the drawing canvas. */
function traceOf(countryId: string): CountryDrawing {
  const outline = countryById(countryId);
  if (!outline) throw new Error(`Unknown country ${countryId}`);
  return outline.rings.map((ring) =>
    ring.map(([x, y]) => ({ x: 137 + x * outline.aspect * 0.05, y: 83 + y * 0.05 })),
  );
}

describe("Draw the Country rooms", () => {
  it("keeps the round's answer available to players but never leaks other drawings", async () => {
    const room = await hostedRoom();
    const player = await joined(room.roomId, room.joinToken, "Maya");
    const started = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    expect(started.accepted).toBe(true);
    const round = started.snapshot?.round;
    expect(round).toBeTruthy();

    // A stroke at coordinates nothing else in the snapshot would produce.
    const secret = [
      [
        { x: 611.25, y: 372.5 },
        { x: 733.75, y: 372.5 },
        { x: 672.5, y: 486.25 },
      ],
    ];
    await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: player.playerId,
      playerToken: player.playerToken,
      action: { type: "drawing.submit", roundId: round!.id, drawing: secret },
    });

    // Another player's strokes are never part of anyone else's snapshot.
    const hostView = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    const serialized = JSON.stringify(hostView.snapshot);
    expect(serialized).not.toContain("611.25");
    expect(serialized).not.toContain("486.25");
    expect(hostView.snapshot?.players.find(({ id }) => id === player.playerId)?.submitted).toBe(
      true,
    );
  });

  it("rejects a stranger's token for a room they never joined", async () => {
    const room = await hostedRoom();
    const result = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: "not-the-right-token",
      lastSequence: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.snapshot).toBeNull();
  });

  it("refuses a second player using a name already in the room", async () => {
    const room = await hostedRoom();
    await joined(room.roomId, room.joinToken, "Maya");
    const duplicate = await joinDrawCountryRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "maya",
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errorCode).toBe("name_taken");
  });

  it("closes the lobby once the game is under way", async () => {
    const room = await hostedRoom();
    await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    const late = await joinDrawCountryRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Latecomer",
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.errorCode).toBe("game_started");
  });

  it("scores everyone at the reveal, counting a missing drawing as zero", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T11:00:00Z"));
    const room = await hostedRoom(2, 30);
    const player = await joined(room.roomId, room.joinToken, "Maya");
    const started = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    const round = started.snapshot!.round!;
    await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "drawing.submit", roundId: round.id, drawing: traceOf(round.countryId) },
    });

    // The clock runs out with the second player never having drawn anything.
    vi.setSystemTime(round.endsAt + 1);
    const revealed = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    expect(revealed.snapshot?.phase).toBe("reveal");
    const scores = new Map(revealed.snapshot?.players.map((p) => [p.id, p.roundScore]));
    expect(scores.get(room.playerId)).toBe(100);
    expect(scores.get(player.playerId)).toBe(0);
  });

  it("ignores a resubmitted drawing so a retry cannot overwrite a locked answer", async () => {
    const room = await hostedRoom();
    const started = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    const round = started.snapshot!.round!;
    const submit = (drawing: CountryDrawing) =>
      applyDrawCountryAction({
        roomId: room.roomId,
        playerId: room.playerId,
        playerToken: room.playerToken,
        action: { type: "drawing.submit", roundId: round.id, drawing },
      });

    await submit(traceOf(round.countryId));
    // A duplicate delivery of a much worse drawing must not replace the accepted one.
    await submit([
      [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 15, y: 20 },
      ],
    ]);
    const revealed = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    expect(revealed.snapshot?.players.find(({ id }) => id === room.playerId)?.roundScore).toBe(100);
  });

  it("refuses a drawing aimed at a round that has already moved on", async () => {
    const room = await hostedRoom();
    const started = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    const stale = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: {
        type: "drawing.submit",
        roundId: `${started.snapshot!.round!.id}-old`,
        drawing: traceOf(started.snapshot!.round!.countryId),
      },
    });
    expect(stale.accepted).toBe(false);
  });

  it("only lets the host drive the rounds while the host is present", async () => {
    const room = await hostedRoom();
    const player = await joined(room.roomId, room.joinToken, "Maya");
    const attempt = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: player.playerId,
      playerToken: player.playerToken,
      action: { type: "game.start" },
    });
    expect(attempt.accepted).toBe(false);
    expect(attempt.snapshot?.phase).toBe("lobby");
  });

  it("hands control to another player once the host has gone quiet", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T11:00:00Z"));
    const room = await hostedRoom();
    const player = await joined(room.roomId, room.joinToken, "Maya");

    // The host stops polling; the remaining player keeps the room alive past the takeover window.
    vi.setSystemTime(Date.now() + 40_000);
    const takeover = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: player.playerId,
      playerToken: player.playerToken,
      action: { type: "game.start" },
    });
    expect(takeover.accepted).toBe(true);
    expect(takeover.snapshot?.phase).toBe("drawing");
  });

  it("runs to a finish and then reports the room as finished", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T11:00:00Z"));
    const room = await hostedRoom(1, 30);
    const started = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    vi.setSystemTime(started.snapshot!.round!.endsAt + 1);
    const revealed = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    expect(revealed.snapshot?.phase).toBe("reveal");

    vi.setSystemTime(revealed.snapshot!.round!.nextRoundAt! + 1);
    const finished = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    expect(finished.snapshot?.phase).toBe("finished");
  });

  it("replays with the same people, banking the last game into a session total", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T11:00:00Z"));
    const room = await hostedRoom(1, 30);
    const player = await joined(room.roomId, room.joinToken, "Maya");
    const started = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    const firstRound = started.snapshot!.round!;
    await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: {
        type: "drawing.submit",
        roundId: firstRound.id,
        drawing: traceOf(firstRound.countryId),
      },
    });
    vi.setSystemTime(firstRound.endsAt + 1);
    const revealed = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    vi.setSystemTime(revealed.snapshot!.round!.nextRoundAt! + 1);
    const finished = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    expect(finished.snapshot?.phase).toBe("finished");
    const earned = finished.snapshot!.players.find(({ id }) => id === room.playerId)!.score;
    expect(earned).toBeGreaterThan(0);

    const replay = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.replay" },
    });
    expect(replay.accepted).toBe(true);
    const next = replay.snapshot!;
    expect(next.phase).toBe("drawing");
    expect(next.gameNumber).toBe(2);
    // Everyone who was in the room is still in it, under the same room code.
    expect(next.players.map(({ name }) => name).toSorted()).toEqual(["Abel", "Maya"]);
    expect(next.roomId).toBe(room.roomId);
    const host = next.players.find(({ id }) => id === room.playerId)!;
    expect(host.score).toBe(0);
    expect(host.sessionScore).toBe(earned);
    // A fresh country, not the one they just drew.
    expect(next.round!.countryId).not.toBe(firstRound.countryId);

    // The player's existing credentials still work — nobody has to rejoin.
    const asPlayer = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: player.playerId,
      playerToken: player.playerToken,
      lastSequence: 0,
    });
    expect(asPlayer.snapshot?.gameNumber).toBe(2);
  });

  it("sends everyone back to the lobby so latecomers can still join", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T11:00:00Z"));
    const room = await hostedRoom(1, 30);
    const started = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    vi.setSystemTime(started.snapshot!.round!.endsAt + 1);
    const revealed = await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });
    vi.setSystemTime(revealed.snapshot!.round!.nextRoundAt! + 1);
    await readDrawCountrySnapshot({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      lastSequence: 0,
    });

    const lobby = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.lobby" },
    });
    expect(lobby.accepted).toBe(true);
    expect(lobby.snapshot?.phase).toBe("lobby");

    // The lobby is open again, which is the whole point of going back to it.
    const latecomer = await joinDrawCountryRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Sam",
    });
    expect(latecomer.ok).toBe(true);
  });

  it("refuses a rematch while a game is still running", async () => {
    const room = await hostedRoom(2, 30);
    await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.start" },
    });
    const replay = await applyDrawCountryAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action: { type: "game.replay" },
    });
    expect(replay.accepted).toBe(false);
  });

  it("reports an unknown room rather than inventing one", async () => {
    const result = await readDrawCountrySnapshot({
      roomId: "ZZZZZZZ",
      playerId: "nobody",
      playerToken: "nothing",
      lastSequence: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("room_unavailable");
  });
});
