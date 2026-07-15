import { createServerFn } from "@tanstack/react-start";
import { partyDeckCatalog } from "./party-content.server";
import { applyPlayerAction, applyPresenterAction, closePartyRoom, createPartyRoom, joinPartyRoom, readPartySnapshot } from "./party-room.server";
import type { PartyClueKind, PartyCustomDeckInput, PartyPlayerAction, PartyPresenterAction, PartyRole } from "./types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) throw new Error("Invalid text");
  return value;
}
function roomId(value: unknown) {
  const id = text(value, 12).toUpperCase();
  if (!/^[A-Z2-9]{7}$/.test(id)) throw new Error("Invalid room");
  return id;
}
function actionId(value: unknown) { return text(value, 80); }
function credential(value: unknown) { return text(value, 120); }
function sequence(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0; }

function optionalText(value: unknown, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function customDeck(value: unknown): PartyCustomDeckInput | undefined {
  if (value === undefined || value === null) return undefined;
  const data = record(value);
  if (!Array.isArray(data.words) || data.words.length < 3 || data.words.length > 200) throw new Error("Invalid custom deck");
  return {
    id: text(data.id, 80),
    name: text(data.name, 50).trim(),
    words: data.words.map((candidate) => {
      const word = record(candidate);
      return {
        id: text(word.id, 100),
        word: text(word.word, 80).trim(),
        partOfSpeech: optionalText(word.partOfSpeech, 30),
        definition: optionalText(word.definition, 220),
        speakAs: optionalText(word.speakAs, 100),
        sentence: optionalText(word.sentence, 240),
      };
    }),
  };
}

function role(value: unknown): PartyRole {
  if (value === "presenter" || value === "player") return value;
  throw new Error("Invalid role");
}

function presenterAction(value: unknown): PartyPresenterAction {
  const data = record(value);
  const id = actionId(data.actionId);
  if (data.type === "round.start" || data.type === "round.next") return { actionId: id, type: data.type };
  throw new Error("Invalid action");
}

function clue(value: unknown): PartyClueKind {
  if (value === "repeat" || value === "definition" || value === "sentence") return value;
  throw new Error("Invalid clue");
}

function playerAction(value: unknown): PartyPlayerAction {
  const data = record(value);
  const base = { actionId: actionId(data.actionId), roundId: text(data.roundId, 120) };
  if (data.type === "draft.update") return { ...base, type: data.type, draft: typeof data.draft === "string" ? data.draft.slice(0, 64) : "", draftRevision: sequence(data.draftRevision) };
  if (data.type === "answer.lock") return { ...base, type: data.type };
  if (data.type === "clue.request") return { ...base, type: data.type, clue: clue(data.clue) };
  if (data.type === "integrity.notice") return { ...base, type: data.type, hiddenMs: Math.min(10 * 60_000, sequence(data.hiddenMs)) };
  throw new Error("Invalid action");
}

export const partyDeckCatalogFn = createServerFn({ method: "GET" }).handler(() => partyDeckCatalog());

export const createPartyRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const recentWordIds = Array.isArray(data.recentWordIds) ? data.recentWordIds.slice(0, 200).map((id) => text(id, 100)) : [];
    return { deckId: text(data.deckId, 80), customDeck: customDeck(data.customDeck), recentWordIds, answerSeconds: Math.max(8, Math.min(60, sequence(data.answerSeconds) || 20)), roundTotal: Math.max(1, Math.min(24, sequence(data.roundTotal) || 5)) };
  })
  .handler(({ data }) => createPartyRoom(data));

export const joinPartyRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), joinToken: data.joinToken === undefined ? undefined : credential(data.joinToken), name: text(data.name, 40), joinId: actionId(data.joinId) };
  })
  .handler(({ data }) => joinPartyRoom(data));

export const readPartySnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), role: role(data.role), credential: credential(data.credential), playerId: typeof data.playerId === "string" ? data.playerId.slice(0, 120) : undefined, lastSequence: sequence(data.lastSequence) };
  })
  .handler(({ data }) => readPartySnapshot(data));

export const applyPresenterActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), presenterToken: credential(data.presenterToken), action: presenterAction(data.action) };
  })
  .handler(({ data }) => applyPresenterAction(data));

export const applyPlayerActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), playerId: text(data.playerId, 120), playerToken: credential(data.playerToken), action: playerAction(data.action) };
  })
  .handler(({ data }) => applyPlayerAction(data));

export const closePartyRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return { roomId: roomId(data.roomId), presenterToken: credential(data.presenterToken) };
  })
  .handler(({ data }) => closePartyRoom(data.roomId, data.presenterToken));
