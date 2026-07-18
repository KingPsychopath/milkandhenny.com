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
  it("uses a validated room-local custom deck without exposing its word to players", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-15T11:00:00Z"));
    const customDeck = {
      id: "spelling-custom-family",
      name: "Family words",
      words: [
        { id: "custom-one", word: "kumquat", definition: "a small citrus fruit", sentence: "She sliced a kumquat into the salad." },
        { id: "custom-two", word: "gazebo", sentence: "We ate lunch beneath the gazebo." },
        { id: "custom-three", word: "ukulele", sentence: "She learned a song on the ukulele." },
      ],
    };
    const room = await createPartyRoom({ deckId: customDeck.id, customDeck, answerSeconds: 20, roundTotal: 3 });
    const player = await joined(room.roomId, room.joinToken, "Maya", "custom-join");
    const started = await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "custom-start", type: "round.start" } });
    expect(started.snapshot?.round?.wordAudioUrl).toBeNull();
    expect(customDeck.words.map(({ word }) => word)).toContain(started.snapshot?.round?.spokenWord);

    const playerView = await readPartySnapshot({ roomId: room.roomId, role: "player", credential: player.playerToken, playerId: player.playerId, lastSequence: 0 });
    expect(playerView.snapshot?.round).not.toHaveProperty("spokenWord");
    expect(JSON.stringify(playerView.snapshot)).not.toContain(started.snapshot?.round?.spokenWord ?? "missing");

    vi.setSystemTime(started.snapshot!.round!.answerOpensAt + 1);
    await applyPlayerAction({ roomId: room.roomId, playerId: player.playerId, playerToken: player.playerToken, action: { actionId: "custom-repeat", type: "clue.request", roundId: started.snapshot!.round!.roundId, clue: "repeat" } });
    const presenterView = await readPartySnapshot({ roomId: room.roomId, role: "presenter", credential: room.presenterToken, lastSequence: 0 });
    const playerAfterClue = await readPartySnapshot({ roomId: room.roomId, role: "player", credential: player.playerToken, playerId: player.playerId, lastSequence: 0 });
    expect(presenterView.snapshot?.round?.activeClue?.speechText).toBe(started.snapshot?.round?.spokenWord);
    expect(playerAfterClue.snapshot?.round?.activeClue).not.toHaveProperty("speechText");
    await applyPlayerAction({ roomId: room.roomId, playerId: player.playerId, playerToken: player.playerToken, action: { actionId: "custom-sentence", type: "clue.request", roundId: started.snapshot!.round!.roundId, clue: "sentence" } });
    const afterSentence = await readPartySnapshot({ roomId: room.roomId, role: "presenter", credential: room.presenterToken, lastSequence: 0 });
    const expectedSentence = customDeck.words.find(({ word }) => word === started.snapshot?.round?.spokenWord)?.sentence;
    expect(afterSentence.snapshot?.round?.activeClue?.speechText).toBe(expectedSentence);
  });

  it("prioritizes words that have not appeared in recent games", async () => {
    const deck = partyDeck("warm-up")!;
    const recentWordIds = deck.words.slice(0, 20).map(({ id }) => id);
    const room = await createPartyRoom({ deckId: deck.id, recentWordIds, answerSeconds: 20, roundTotal: 4 });
    expect(room.selectedWordIds).toHaveLength(4);
    expect(room.selectedWordIds.every((id) => !recentWordIds.includes(id))).toBe(true);
  });

  it("allows a player with the room code to join while the lobby is open", async () => {
    const room = await createPartyRoom({ deckId: "warm-up", answerSeconds: 20, roundTotal: 3 });
    const player = await joinPartyRoom({ roomId: room.roomId, name: "Maya", joinId: "code-join" });
    expect(player).not.toHaveProperty("error");
    if ("error" in player) throw new Error(player.error);
    await applyPresenterAction({ roomId: room.roomId, presenterToken: room.presenterToken, action: { actionId: "start-after-code", type: "round.start" } });
    expect(await joinPartyRoom({ roomId: room.roomId, name: "Daniel", joinId: "late-code-join" })).toEqual({
      ok: false,
      errorCode: "game_started",
      error: "This game has already started",
      retryable: false,
    });
  });

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

    const assetId = countdown.round!.wordAudioUrl!.split("/").at(-1)!;
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
