import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import {
  applyPlayerAction,
  applyPresenterAction,
  closePartyRoom,
  createPartyRoom,
  getPartyAudioAsset,
  joinPartyRoom,
  readPartySnapshot,
} from "../../features/things/spelling-party/party-room.server";
import { partyDeck, partyAudioAssetKey } from "../../features/things/spelling-party/party-content.server";

afterEach(() => vi.useRealTimers());

async function joined(roomId: string, joinToken: string, name: string, joinId: string) {
  const result = await joinPartyRoom({ roomId, joinToken, name, joinId });
  if ("error" in result) throw new Error(result.error);
  return result;
}

describe("Party Typing rooms", () => {
  it("keeps the word and private drafts secret, then reveals and scores everyone together", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    const room = await createPartyRoom({ deckId: "warm-up", answerSeconds: 20, roundTotal: 3 });
    const maya = await joined(room.roomId, room.joinToken, "Maya", "join-maya");
    const daniel = await joined(room.roomId, room.joinToken, "Daniel", "join-daniel");
    const started = await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "start-1", type: "round.start" } });
    expect(started.accepted).toBe(true);
    const countdown = started.snapshot!;
    expect(countdown.phase).toBe("countdown");
    expect(countdown.round).not.toHaveProperty("correctWord");
    expect(JSON.stringify(countdown)).not.toContain("beautiful");

    const assetId = countdown.round!.wordAudioUrl.split("/").at(-1)!;
    const assetKey = await getPartyAudioAsset(room.roomId, assetId);
    const deck = partyDeck("warm-up")!;
    const secret = deck.words.find((word) => partyAudioAssetKey(word, "word") === assetKey)!;
    vi.setSystemTime(countdown.round!.answerOpensAt + 10);

    const mayaDraft = await applyPlayerAction({ roomId: room.roomId, playerId: maya.playerId, playerToken: maya.playerToken, action: { actionId: "maya-draft", type: "draft.update", roundId: countdown.round!.roundId, draft: secret.word, draftRevision: 1 } });
    expect(mayaDraft.accepted).toBe(true);
    await applyPlayerAction({ roomId: room.roomId, playerId: daniel.playerId, playerToken: daniel.playerToken, action: { actionId: "daniel-draft", type: "draft.update", roundId: countdown.round!.roundId, draft: "wrong", draftRevision: 1 } });
    const presenterBeforeReveal = await readPartySnapshot({ roomId: room.roomId, role: "presenter", credential: room.presenterToken, lastSequence: 0 });
    expect(JSON.stringify(presenterBeforeReveal.snapshot)).not.toContain(secret.word);
    expect(JSON.stringify(presenterBeforeReveal.snapshot)).not.toContain("wrong");

    await applyPlayerAction({ roomId: room.roomId, playerId: maya.playerId, playerToken: maya.playerToken, action: { actionId: "maya-lock", type: "answer.lock", roundId: countdown.round!.roundId } });
    const allLocked = await applyPlayerAction({ roomId: room.roomId, playerId: daniel.playerId, playerToken: daniel.playerToken, action: { actionId: "daniel-lock", type: "answer.lock", roundId: countdown.round!.roundId } });
    expect(allLocked.snapshot?.phase).toBe("locked");
    expect(allLocked.snapshot?.round).not.toHaveProperty("correctWord");
    vi.setSystemTime(allLocked.snapshot!.round!.revealAt + 1);
    const revealed = await readPartySnapshot({ roomId: room.roomId, role: "presenter", credential: room.presenterToken, lastSequence: allLocked.snapshot!.sequence });
    expect(revealed.snapshot?.phase).toBe("reveal");
    expect(revealed.snapshot?.round?.correctWord).toBe(secret.word);
    expect(revealed.snapshot?.round?.answers?.map(({ name, place }) => ({ name, place }))).toEqual([
      { name: "Maya", place: 1 },
      { name: "Daniel", place: 2 },
    ]);
    expect(revealed.snapshot?.players.find(({ id }) => id === maya.playerId)?.score).toBe(1);
    expect(revealed.snapshot?.players.find(({ id }) => id === daniel.playerId)?.score).toBe(0);
  });

  it("automatically locks the latest synchronized draft and returns a complete reconnect snapshot", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-15T13:00:00Z"));
    const room = await createPartyRoom({ deckId: "warm-up", answerSeconds: 10, roundTotal: 1 });
    const player = await joined(room.roomId, room.joinToken, "Ava", "join-ava");
    const started = await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "start-auto", type: "round.start" } });
    const round = started.snapshot!.round!;
    vi.setSystemTime(round.answerOpensAt + 1);
    await applyPlayerAction({ roomId: room.roomId, playerId: player.playerId, playerToken: player.playerToken, action: { actionId: "ava-draft", type: "draft.update", roundId: round.roundId, draft: "latest draft", draftRevision: 4 } });
    vi.setSystemTime(round.revealAt + 1);
    const reconnect = await readPartySnapshot({ roomId: room.roomId, role: "player", credential: player.playerToken, playerId: player.playerId, lastSequence: 0 });
    expect(reconnect.snapshot?.phase).toBe("reveal");
    expect(reconnect.snapshot?.player).toMatchObject({ draft: "latest draft", draftRevision: 4, locked: true, lockedAutomatically: true });
    const late = await applyPlayerAction({ roomId: room.roomId, playerId: player.playerId, playerToken: player.playerToken, action: { actionId: "late-lock", type: "answer.lock", roundId: round.roundId } });
    expect(late).toMatchObject({ accepted: false, error: "Answers are locked" });
  });

  it("attributes a shared clue once and makes join and actions idempotent", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-15T14:00:00Z"));
    const room = await createPartyRoom({ deckId: "warm-up", answerSeconds: 20, roundTotal: 1 });
    const firstJoin = await joined(room.roomId, room.joinToken, "Maya", "same-join");
    const repeatedJoin = await joined(room.roomId, room.joinToken, "Maya", "same-join");
    expect(repeatedJoin.playerToken).toBe(firstJoin.playerToken);
    const second = await joined(room.roomId, room.joinToken, "Daniel", "join-two");
    const started = await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "same-start", type: "round.start" } });
    const repeatedStart = await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "same-start", type: "round.start" } });
    expect(repeatedStart.snapshot?.round?.roundId).toBe(started.snapshot?.round?.roundId);
    vi.setSystemTime(started.snapshot!.round!.answerOpensAt + 1);
    const clue = await applyPlayerAction({ roomId: room.roomId, playerId: firstJoin.playerId, playerToken: firstJoin.playerToken, action: { actionId: "repeat-one", type: "clue.request", roundId: started.snapshot!.round!.roundId, clue: "repeat" } });
    expect(clue.snapshot?.recentClues.at(-1)?.message).toBe("Maya asked to hear it again.");
    const duplicate = await applyPlayerAction({ roomId: room.roomId, playerId: second.playerId, playerToken: second.playerToken, action: { actionId: "repeat-two", type: "clue.request", roundId: started.snapshot!.round!.roundId, clue: "repeat" } });
    expect(duplicate).toMatchObject({ accepted: false, error: "The word is already being repeated" });
  });

  it("closes rooms idempotently and keeps finished results only for the reconnect grace period", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-15T15:00:00Z"));
    const disposable = await createPartyRoom({ deckId: "warm-up", answerSeconds: 10, roundTotal: 1 });
    expect((await closePartyRoom(disposable.roomId, "wrong-token")).ok).toBe(false);
    expect((await closePartyRoom(disposable.roomId, disposable.presenterToken)).ok).toBe(true);
    expect((await closePartyRoom(disposable.roomId, disposable.presenterToken)).ok).toBe(true);

    const room = await createPartyRoom({ deckId: "warm-up", answerSeconds: 10, roundTotal: 1 });
    const player = await joined(room.roomId, room.joinToken, "Ava", "join-finish");
    const started = await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "start-finish", type: "round.start" } });
    vi.setSystemTime(started.snapshot!.round!.answerOpensAt + 1);
    const locked = await applyPlayerAction({ roomId: room.roomId, playerId: player.playerId, playerToken: player.playerToken, action: { actionId: "lock-finish", type: "answer.lock", roundId: started.snapshot!.round!.roundId } });
    vi.setSystemTime(locked.snapshot!.round!.revealAt + 1);
    await readPartySnapshot({ roomId: room.roomId, role: "presenter", credential: room.presenterToken, lastSequence: 0 });
    const finished = await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "finish", type: "round.next" } });
    expect(finished.snapshot?.phase).toBe("finished");
    vi.advanceTimersByTime(14 * 60_000);
    expect((await readPartySnapshot({ roomId: room.roomId, role: "presenter", credential: room.presenterToken, lastSequence: 0 })).ok).toBe(true);
    vi.advanceTimersByTime(2 * 60_000);
    expect((await readPartySnapshot({ roomId: room.roomId, role: "presenter", credential: room.presenterToken, lastSequence: 0 })).ok).toBe(false);
  });
});
