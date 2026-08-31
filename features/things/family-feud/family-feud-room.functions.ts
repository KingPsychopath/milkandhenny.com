import { createServerFn } from "@tanstack/react-start";

import {
  multiplayerBoundedText,
  multiplayerCredential,
  multiplayerRecord,
  multiplayerRoomId,
  multiplayerSequence,
  multiplayerText,
  optionalMultiplayerText,
} from "../shared/multiplayer-validation";
import {
  applyFamilyFeudBuzzerAction,
  applyFamilyFeudControllerAction,
  closeFamilyFeudRoom,
  createFamilyFeudRoom,
  pairFamilyFeudController,
  readFamilyFeudSnapshot,
} from "./family-feud-room.server";
import type {
  FamilyFeudBuzzerAction,
  FamilyFeudCardDefinition,
  FamilyFeudControllerAction,
  FamilyFeudCustomDeckInput,
  FamilyFeudTeamId,
  FamilyFeudVibeId,
  FamilyFeudViewerRole,
} from "./types";

const record = multiplayerRecord;
const credential = multiplayerCredential;
const sequence = multiplayerSequence;
const actionId = (value: unknown) => multiplayerText(value, 80);

function teamId(value: unknown): FamilyFeudTeamId {
  if (value !== "one" && value !== "two") throw new Error("Invalid team");
  return value;
}

function role(value: unknown): FamilyFeudViewerRole {
  if (value !== "presenter" && value !== "controller" && value !== "buzzer")
    throw new Error("Invalid role");
  return value;
}

function vibeId(value: unknown): FamilyFeudVibeId {
  if (
    value !== "london-link-up" &&
    value !== "family-function" &&
    value !== "night-out" &&
    value !== "after-dark" &&
    value !== "full-london-mix" &&
    value !== "choose-own"
  )
    throw new Error("Invalid vibe");
  return value;
}

function card(value: unknown, cardIndex: number): FamilyFeudCardDefinition {
  const data = record(value);
  const cardId = optionalMultiplayerText(data.id, 100) ?? `custom:card:${cardIndex + 1}`;
  if (!Array.isArray(data.answers) || data.answers.length !== 10)
    throw new Error("Each card needs ten answers");
  return {
    id: cardId,
    prompt: multiplayerBoundedText(data.prompt, 140, "Invalid prompt").trim(),
    answers: data.answers.map((entry, answerIndex) => {
      const answerData = typeof entry === "string" ? { label: entry } : record(entry);
      return {
        id: optionalMultiplayerText(answerData.id, 120) ?? `${cardId}:answer:${answerIndex + 1}`,
        label: multiplayerBoundedText(answerData.label, 56, "Invalid answer").trim(),
        aliases: Array.isArray(answerData.aliases)
          ? answerData.aliases
              .slice(0, 8)
              .map((alias) => multiplayerBoundedText(alias, 56, "Invalid alias").trim())
              .filter(Boolean)
          : [],
      };
    }),
  };
}

function customDeck(value: unknown): FamilyFeudCustomDeckInput {
  const data = record(value);
  if (!Array.isArray(data.cards) || data.cards.length < 4 || data.cards.length > 80)
    throw new Error("A custom deck needs 4–80 cards");
  return {
    id: optionalMultiplayerText(data.id, 100) ?? `custom:${Date.now()}`,
    name: multiplayerBoundedText(data.name, 48, "Invalid deck name").trim(),
    cards: data.cards.map(card),
  };
}

function controllerAction(value: unknown): FamilyFeudControllerAction {
  const data = record(value);
  const base = { actionId: actionId(data.actionId) };
  if (
    data.type === "game.start" ||
    data.type === "phase.advance" ||
    data.type === "card.skip" ||
    data.type === "card.next" ||
    data.type === "card.previous" ||
    data.type === "card.use" ||
    data.type === "round.replace" ||
    data.type === "faceoff.open" ||
    data.type === "faceoff.miss" ||
    data.type === "steal.miss" ||
    data.type === "timer.pause" ||
    data.type === "timer.resume" ||
    data.type === "timer.reset" ||
    data.type === "undo.last" ||
    data.type === "result.confirm" ||
    data.type === "sudden-death.start" ||
    data.type === "game.replay" ||
    data.type === "game.end"
  )
    return { ...base, type: data.type };
  if (data.type === "faceoff.claim")
    return { ...base, type: data.type, teamId: teamId(data.teamId) };
  if (data.type === "answer.reveal" || data.type === "answer.hide")
    return { ...base, type: data.type, answerId: multiplayerText(data.answerId, 140) };
  if (data.type === "answer.reassign")
    return {
      ...base,
      type: data.type,
      answerId: multiplayerText(data.answerId, 140),
      teamId: teamId(data.teamId),
    };
  if (data.type === "score.adjust") {
    const points = Number(data.points);
    if (!Number.isInteger(points)) throw new Error("Invalid points");
    return { ...base, type: data.type, teamId: teamId(data.teamId), points };
  }
  if (data.type === "house-answer.add")
    return {
      ...base,
      type: data.type,
      label: multiplayerBoundedText(data.label, 56, "Invalid answer"),
      teamId: data.teamId === undefined ? undefined : teamId(data.teamId),
    };
  if (data.type === "claim.display") {
    if (data.display === null) return { ...base, type: data.type, display: null };
    const display = record(data.display);
    return {
      ...base,
      type: data.type,
      display: {
        sessionId: multiplayerText(display.sessionId, 120),
        teamId: teamId(display.teamId),
        teamName: multiplayerText(display.teamName, 48),
        points: sequence(display.points),
        claimed: sequence(display.claimed),
        maximumClaims: sequence(display.maximumClaims),
        claimUrl: multiplayerText(display.claimUrl, 2_000),
        expiresAt: sequence(display.expiresAt),
      },
    };
  }
  throw new Error("Invalid action");
}

function buzzerAction(value: unknown): FamilyFeudBuzzerAction {
  const data = record(value);
  if (data.type !== "buzzer.hit") throw new Error("Invalid action");
  return { actionId: actionId(data.actionId), type: data.type, teamId: teamId(data.teamId) };
}

export const createFamilyFeudRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    const teams = Array.isArray(data.teams)
      ? data.teams.slice(0, 2).map((entry) => {
          const item = record(entry);
          return {
            name: optionalMultiplayerText(item.name, 28),
            playerCount: item.playerCount === undefined ? undefined : sequence(item.playerCount),
          };
        })
      : undefined;
    return {
      deckId: optionalMultiplayerText(data.deckId, 100),
      deckIds: Array.isArray(data.deckIds)
        ? data.deckIds.slice(0, 20).map((deckId) => multiplayerText(deckId, 100))
        : undefined,
      vibeId: data.vibeId === undefined ? undefined : vibeId(data.vibeId),
      adultContent: data.adultContent === true,
      customDeck: data.customDeck === undefined ? undefined : customDeck(data.customDeck),
      customDecks: Array.isArray(data.customDecks)
        ? data.customDecks.slice(0, 20).map(customDeck)
        : undefined,
      rounds: data.rounds === undefined ? undefined : sequence(data.rounds),
      mainSeconds: data.mainSeconds === undefined ? undefined : sequence(data.mainSeconds),
      stealSeconds: data.stealSeconds === undefined ? undefined : sequence(data.stealSeconds),
      firstTeamId: data.firstTeamId === undefined ? undefined : teamId(data.firstTeamId),
      teams,
    };
  })
  .handler(({ data }) => createFamilyFeudRoom(data));

export const readFamilyFeudSnapshotFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      role: role(data.role),
      credential: credential(data.credential),
      lastSequence: data.lastSequence === undefined ? undefined : sequence(data.lastSequence),
      lastDigest:
        typeof data.lastDigest === "string"
          ? data.lastDigest.slice(0, 24)
          : (null as string | null),
    };
  })
  .handler(({ data }) => readFamilyFeudSnapshot(data));

export const pairFamilyFeudControllerFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      pairingToken: credential(data.pairingToken),
    };
  })
  .handler(({ data }) => pairFamilyFeudController(data));

export const applyFamilyFeudControllerActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      controllerToken: credential(data.controllerToken),
      action: controllerAction(data.action),
    };
  })
  .handler(({ data }) => applyFamilyFeudControllerAction(data));

export const applyFamilyFeudBuzzerActionFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      buzzerToken: credential(data.buzzerToken),
      action: buzzerAction(data.action),
    };
  })
  .handler(({ data }) => applyFamilyFeudBuzzerAction(data));

export const closeFamilyFeudRoomFn = createServerFn({ method: "POST" })
  .validator((value: unknown) => {
    const data = record(value);
    return {
      roomId: multiplayerRoomId(data.roomId),
      controllerToken: credential(data.controllerToken),
    };
  })
  .handler(({ data }) => closeFamilyFeudRoom(data.roomId, data.controllerToken));
