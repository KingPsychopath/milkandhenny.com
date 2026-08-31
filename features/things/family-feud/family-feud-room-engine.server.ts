import { randomInt } from "node:crypto";

import {
  persistRoomWithOfficialResults,
  publishOfficialResultsAfterCommit,
  sealOfficialGameResult,
} from "@/features/game-results/outbox.server";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
import { log } from "@/lib/platform/logger.server";
import { getRedis } from "@/lib/platform/redis.server";
import {
  multiplayerFailure,
  multiplayerLobbyExpiresAt,
  multiplayerRoomExpiry,
  type MultiplayerRoomPhaseKind,
} from "../shared/multiplayer";
import {
  createAvailableMultiplayerRoomId,
  createMemoryRoomStore,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerActionSeen,
  multiplayerCredentialsMatch,
  multiplayerRoomStateChanged,
  multiplayerSnapshotDigest,
  registerMemoryRoomSweeper,
  remainingMultiplayerRoomTtlSeconds,
  rememberMultiplayerAction,
  withMultiplayerRoomLock,
  type MultiplayerLockAttempt,
} from "../shared/room-primitives.server";
import {
  FAMILY_FEUD_PRACTICE_CARD,
  familyFeudDeck,
  familyFeudDecks,
  familyFeudRoundDeckSequence,
  familyFeudVibe,
} from "./family-feud-content";
import { familyFeudRoomRedisKeys } from "./family-feud-keys";
import {
  FAMILY_FEUD_DEFAULT_MAIN_SECONDS,
  FAMILY_FEUD_DEFAULT_ROUNDS,
  FAMILY_FEUD_DEFAULT_STEAL_SECONDS,
  FAMILY_FEUD_FACE_OFF_SECONDS,
  FAMILY_FEUD_MAIN_SECOND_OPTIONS,
  FAMILY_FEUD_PLAYER_LIMITS,
  FAMILY_FEUD_ROUND_OPTIONS,
  FAMILY_FEUD_STEAL_SECOND_OPTIONS,
  familyFeudActiveTeam,
  familyFeudAnswerMatches,
  familyFeudBoardValue,
  familyFeudPlacements,
  normaliseFamilyFeudAnswer,
  otherFamilyFeudTeam,
  validateFamilyFeudCard,
} from "./family-feud-rules";
import type {
  FamilyFeudActionResult,
  FamilyFeudAnswerDefinition,
  FamilyFeudBuzzerAction,
  FamilyFeudCardDefinition,
  FamilyFeudClaimDisplay,
  FamilyFeudControllerAction,
  FamilyFeudCustomDeckInput,
  FamilyFeudPhase,
  FamilyFeudRejectionCode,
  FamilyFeudRoomCredentials,
  FamilyFeudRoomErrorCode,
  FamilyFeudSnapshot,
  FamilyFeudSnapshotResult,
  FamilyFeudTeamId,
  FamilyFeudVibeId,
  FamilyFeudViewerRole,
} from "./types";

const CONNECTED_WINDOW_MS = 25_000;
const FINISHED_GRACE_MS = 30 * 60 * 1_000;

interface TeamState {
  id: FamilyFeudTeamId;
  marker: "circle" | "triangle";
  name: string;
  playerCount: number;
  score: number;
  roundPoints: number;
}

interface AnswerState extends FamilyFeudAnswerDefinition {
  revealed: boolean;
  awardedTeamId?: FamilyFeudTeamId;
  points?: number;
}

interface HouseAnswerState {
  id: string;
  label: string;
  teamId: FamilyFeudTeamId;
  points: number;
}

interface RoundState {
  number: number;
  total: number;
  activeTeamId: FamilyFeudTeamId;
  cardId: string;
  deckId: string;
  deckName: string;
  cardLocked: boolean;
  prompt: string;
  answers: AnswerState[];
  houseAnswers: HouseAnswerState[];
  faceoffTeamId: FamilyFeudTeamId | null;
  faceoffAttemptedTeamIds: FamilyFeudTeamId[];
  phaseStartedAt: number;
  phaseEndsAt: number;
  paused: boolean;
  pausedRemainingMs: number;
}

interface ScoreUndoState {
  teams: Array<Pick<TeamState, "id" | "score" | "roundPoints">>;
  answers: Array<Pick<AnswerState, "id" | "revealed" | "awardedTeamId" | "points">>;
  houseAnswers: HouseAnswerState[];
  phase?: FamilyFeudPhase;
  cue?: FamilyFeudSnapshot["cue"];
  winnerTeamIds?: FamilyFeudTeamId[];
  faceoffTeamId?: FamilyFeudTeamId | null;
  faceoffAttemptedTeamIds?: FamilyFeudTeamId[];
  paused?: boolean;
  timerRemainingMs?: number;
}

interface FamilyFeudRoomState {
  roomId: string;
  officialResultChannelId?: string;
  phase: FamilyFeudPhase;
  revision: number;
  sequence: number;
  expiresAt: number;
  presenterHash: string;
  controllerHash: string;
  controllerPairingHash: string | null;
  controllerRecoveryHash?: string;
  buzzerHash: string;
  buzzerHashes?: Partial<Record<FamilyFeudTeamId, string>>;
  lastControllerSeenAt: number;
  gameNumber: number;
  rounds: number;
  mainSeconds: number;
  stealSeconds: number;
  deckId: string;
  deckName: string;
  cards: FamilyFeudCardDefinition[];
  cardCursor: number;
  roundCandidates?: FamilyFeudCardDefinition[][];
  roundCandidateCursors?: number[];
  usedCardIds?: string[];
  firstTeamId: FamilyFeudTeamId;
  teams: [TeamState, TeamState];
  round: RoundState | null;
  suddenDeath: boolean;
  winnerTeamIds: FamilyFeudTeamId[];
  resultConfirmedAt: number | null;
  claimDisplay: FamilyFeudClaimDisplay | null;
  cue: FamilyFeudSnapshot["cue"];
  processedActions: string[];
  scoreUndo: ScoreUndoState[];
}

const memoryRooms = createMemoryRoomStore<FamilyFeudRoomState>("family-feud");

registerMemoryRoomSweeper("family-feud", (now) => {
  for (const [roomId, room] of memoryRooms) {
    if (room.expiresAt <= now) memoryRooms.delete(roomId);
  }
});

let lockObserver: ((input: MultiplayerLockAttempt) => void) | null = null;

export function setFamilyFeudRoomLockObserver(observer: typeof lockObserver) {
  lockObserver = observer;
}

type RoomKeys = ReturnType<typeof familyFeudRoomRedisKeys>;

function phaseKind(room: FamilyFeudRoomState): MultiplayerRoomPhaseKind {
  if (room.phase === "lobby" || room.phase === "rules") return "lobby";
  if (room.phase === "finished") return "results";
  return "active";
}

function applyExpiry(room: FamilyFeudRoomState, now = Date.now()) {
  room.expiresAt = multiplayerRoomExpiry({
    kind: phaseKind(room),
    presentCount: 1,
    expiresAt: room.expiresAt,
    now,
  });
  if (room.phase === "finished") room.expiresAt = Math.max(room.expiresAt, now + FINISHED_GRACE_MS);
}

function changed(room: FamilyFeudRoomState, now = Date.now()) {
  room.revision += 1;
  room.sequence += 1;
  applyExpiry(room, now);
}

function setCue(
  room: FamilyFeudRoomState,
  kind: NonNullable<FamilyFeudSnapshot["cue"]>["kind"],
  award?: { teamId: FamilyFeudTeamId; points: number },
) {
  room.cue = { id: `${room.sequence + 1}:${kind}`, kind, ...award };
}

function team(room: FamilyFeudRoomState, teamId: FamilyFeudTeamId) {
  return room.teams.find((candidate) => candidate.id === teamId)!;
}

function actionFailure(errorCode: FamilyFeudRoomErrorCode, error: string): FamilyFeudActionResult {
  return { ...multiplayerFailure(errorCode, error), accepted: false, snapshot: null };
}

function reject(
  room: FamilyFeudRoomState,
  errorCode: FamilyFeudRejectionCode,
  error: string,
  role: FamilyFeudViewerRole = "controller",
): FamilyFeudActionResult {
  return {
    ok: true,
    accepted: false,
    snapshot: snapshot(room, role),
    errorCode,
    error,
  };
}

function accept(room: FamilyFeudRoomState, role: FamilyFeudViewerRole): FamilyFeudActionResult {
  return { ok: true, accepted: true, snapshot: snapshot(room, role) };
}

function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function boundedName(value: string | undefined, fallback: string) {
  const result = value?.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 28);
  return result || fallback;
}

function boundedOption<const T extends number>(
  value: number | undefined,
  options: readonly T[],
  fallback: T,
): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function roundCandidates(room: FamilyFeudRoomState, roundNumber: number) {
  const planned = room.roundCandidates?.[roundNumber - 1] ?? room.cards;
  const usedCardIds = room.usedCardIds ?? [];
  const unused = planned.filter(({ id }) => !usedCardIds.includes(id));
  return unused.length ? unused : planned;
}

function currentRoundCard(room: FamilyFeudRoomState, roundNumber: number) {
  const candidates = roundCandidates(room, roundNumber);
  if (!candidates.length) return familyFeudDeck("everyday-life").cards[0]!;
  const cursor = room.roundCandidateCursors?.[roundNumber - 1] ?? 0;
  return candidates[((cursor % candidates.length) + candidates.length) % candidates.length]!;
}

function moveRoundCard(room: FamilyFeudRoomState, roundNumber: number, direction: -1 | 1) {
  const candidates = roundCandidates(room, roundNumber);
  const index = roundNumber - 1;
  const cursors = (room.roundCandidateCursors ??= []);
  const cursor = cursors[index] ?? 0;
  cursors[index] =
    candidates.length > 0 ? (cursor + direction + candidates.length) % candidates.length : 0;
  return currentRoundCard(room, roundNumber);
}

function roundFromCard(
  room: FamilyFeudRoomState,
  card: FamilyFeudCardDefinition,
  number: number,
  total: number,
  now: number,
): RoundState {
  return {
    number,
    total,
    activeTeamId: familyFeudActiveTeam(number, room.firstTeamId),
    cardId: card.id,
    deckId: card.deckId ?? room.deckId,
    deckName: card.deckName ?? room.deckName,
    cardLocked: false,
    prompt: card.prompt,
    answers: card.answers.map((answer) => ({
      ...answer,
      aliases: [...answer.aliases],
      revealed: false,
    })),
    houseAnswers: [],
    faceoffTeamId: null,
    faceoffAttemptedTeamIds: [],
    phaseStartedAt: now,
    phaseEndsAt: 0,
    paused: false,
    pausedRemainingMs: 0,
  };
}

function beginRound(room: FamilyFeudRoomState, number: number, now: number, suddenDeath = false) {
  const card = currentRoundCard(room, number);
  room.suddenDeath = suddenDeath;
  room.round = roundFromCard(room, card, number, suddenDeath ? number : room.rounds, now);
  for (const item of room.teams) item.roundPoints = 0;
  room.scoreUndo = [];
  room.phase = "round-intro";
  changed(room, now);
}

function beginPractice(room: FamilyFeudRoomState, now: number) {
  room.round = roundFromCard(room, FAMILY_FEUD_PRACTICE_CARD, 0, room.rounds, now);
  room.round.activeTeamId = room.firstTeamId;
  room.round.cardLocked = true;
  room.phase = "practice";
  changed(room, now);
}

function setPhase(room: FamilyFeudRoomState, phase: FamilyFeudPhase, now: number, seconds = 0) {
  room.phase = phase;
  if (room.round) {
    room.round.phaseStartedAt = now;
    room.round.phaseEndsAt = seconds > 0 ? now + seconds * 1_000 : 0;
    room.round.paused = false;
    room.round.pausedRemainingMs = 0;
  }
  changed(room, now);
}

function snapshot(room: FamilyFeudRoomState, role: FamilyFeudViewerRole): FamilyFeudSnapshot {
  const now = Date.now();
  const revealAll =
    room.phase === "round-reveal" || room.phase === "round-score" || room.phase === "finished";
  const controller = role === "controller";
  const promptVisible =
    controller ||
    room.phase === "practice" ||
    !["lobby", "rules", "round-intro"].includes(room.phase);
  const result: FamilyFeudSnapshot = {
    roomId: room.roomId,
    phase: room.phase,
    revision: room.revision,
    sequence: room.sequence,
    serverNow: now,
    expiresAt: room.expiresAt,
    gameNumber: room.gameNumber,
    rounds: room.rounds,
    mainSeconds: room.mainSeconds,
    stealSeconds: room.stealSeconds,
    controllerConnected: now - room.lastControllerSeenAt <= CONNECTED_WINDOW_MS,
    eventScoring: Boolean(room.officialResultChannelId),
    teams: room.teams.map((item) => ({
      id: item.id,
      marker: item.marker,
      name: item.name,
      playerCount: item.playerCount,
      score: item.score,
      roundPoints: item.roundPoints,
    })) as FamilyFeudSnapshot["teams"],
    round: room.round
      ? {
          number: room.round.number,
          total: room.round.total,
          activeTeamId: room.round.activeTeamId,
          cardId: room.round.cardId,
          deckId: controller ? (room.round.deckId ?? room.deckId) : undefined,
          deckName: controller ? (room.round.deckName ?? room.deckName) : undefined,
          cardLocked: room.round.cardLocked ?? room.phase !== "round-intro",
          candidatePosition: controller
            ? Math.max(
                1,
                roundCandidates(room, room.round.number).findIndex(
                  ({ id }) => id === room.round?.cardId,
                ) + 1,
              )
            : undefined,
          candidateTotal: controller ? roundCandidates(room, room.round.number).length : undefined,
          prompt: promptVisible ? room.round.prompt : undefined,
          answers: room.round.answers.map((item, position) => ({
            id: item.id,
            position: position + 1,
            boardValue: familyFeudBoardValue(position + 1),
            label: controller || revealAll || item.revealed ? item.label : undefined,
            aliases: controller ? [...item.aliases] : undefined,
            shown: revealAll || item.revealed,
            revealed: item.revealed,
            awardedTeamId: item.awardedTeamId,
            points: item.points,
          })),
          houseAnswers: room.round.houseAnswers.map((item) => ({ ...item })),
          faceoffTeamId: room.round.faceoffTeamId,
          faceoffAttemptedTeamIds: [...room.round.faceoffAttemptedTeamIds],
          phaseStartedAt: room.round.phaseStartedAt,
          phaseEndsAt: room.round.phaseEndsAt,
          paused: room.round.paused,
          pausedRemainingMs: room.round.pausedRemainingMs ?? 0,
        }
      : null,
    winnerTeamIds: [...room.winnerTeamIds],
    resultConfirmed: room.resultConfirmedAt !== null,
    claimDisplay: room.claimDisplay,
    cue: room.cue,
  };
  result.digest = multiplayerSnapshotDigest(result);
  return result;
}

function saveScoreUndo(room: FamilyFeudRoomState) {
  const now = Date.now();
  room.scoreUndo.push({
    teams: room.teams.map(({ id, score, roundPoints }) => ({ id, score, roundPoints })),
    answers:
      room.round?.answers.map(({ id, revealed, awardedTeamId, points }) => ({
        id,
        revealed,
        awardedTeamId,
        points,
      })) ?? [],
    houseAnswers: room.round?.houseAnswers.map((item) => ({ ...item })) ?? [],
    phase: room.phase,
    cue: room.cue ? { ...room.cue } : null,
    winnerTeamIds: [...room.winnerTeamIds],
    faceoffTeamId: room.round?.faceoffTeamId,
    faceoffAttemptedTeamIds: room.round ? [...room.round.faceoffAttemptedTeamIds] : undefined,
    paused: room.round?.paused,
    timerRemainingMs: room.round
      ? room.round.paused
        ? room.round.pausedRemainingMs
        : Math.max(0, room.round.phaseEndsAt - now)
      : undefined,
  });
  room.scoreUndo = room.scoreUndo.slice(-40);
}

function restoreScoreUndo(room: FamilyFeudRoomState) {
  const previous = room.scoreUndo.pop();
  if (!previous) return false;
  for (const priorTeam of previous.teams) {
    const current = team(room, priorTeam.id);
    current.score = priorTeam.score;
    current.roundPoints = priorTeam.roundPoints;
  }
  if (room.round) {
    for (const priorAnswer of previous.answers) {
      const current = room.round.answers.find(({ id }) => id === priorAnswer.id);
      if (!current) continue;
      current.revealed = priorAnswer.revealed;
      current.awardedTeamId = priorAnswer.awardedTeamId;
      current.points = priorAnswer.points;
    }
    room.round.houseAnswers = previous.houseAnswers.map((item) => ({ ...item }));
  }
  if (previous.phase) room.phase = previous.phase;
  if (previous.cue !== undefined) room.cue = previous.cue ? { ...previous.cue } : null;
  if (previous.winnerTeamIds) room.winnerTeamIds = [...previous.winnerTeamIds];
  if (room.round && previous.faceoffTeamId !== undefined)
    room.round.faceoffTeamId = previous.faceoffTeamId;
  if (room.round && previous.faceoffAttemptedTeamIds)
    room.round.faceoffAttemptedTeamIds = [...previous.faceoffAttemptedTeamIds];
  if (room.round && previous.timerRemainingMs !== undefined) {
    const remaining = Math.max(0, previous.timerRemainingMs);
    const now = Date.now();
    room.round.phaseStartedAt = now;
    room.round.paused = previous.paused ?? false;
    room.round.pausedRemainingMs = room.round.paused ? remaining : 0;
    room.round.phaseEndsAt = !room.round.paused && remaining > 0 ? now + remaining : 0;
  }
  return true;
}

function addPoints(room: FamilyFeudRoomState, teamId: FamilyFeudTeamId, points: number) {
  const target = team(room, teamId);
  target.score = Math.max(0, target.score + points);
  target.roundPoints = Math.max(0, target.roundPoints + points);
}

function hiddenAnswers(room: FamilyFeudRoomState) {
  return room.round?.answers.filter(({ revealed }) => !revealed) ?? [];
}

function refreshWinnerTeamIds(room: FamilyFeudRoomState) {
  const scores = { one: team(room, "one").score, two: team(room, "two").score };
  room.winnerTeamIds =
    scores.one === scores.two ? ["one", "two"] : [scores.one > scores.two ? "one" : "two"];
}

function finish(room: FamilyFeudRoomState, now: number) {
  refreshWinnerTeamIds(room);
  setCue(room, "victory");
  setPhase(room, "finished", now);
}

function advanceTimedPhase(room: FamilyFeudRoomState, now = Date.now()) {
  const round = room.round;
  if (!round || round.paused || round.phaseEndsAt <= 0 || now < round.phaseEndsAt) return;
  if (room.phase === "faceoff") {
    if (round.faceoffTeamId === null) return;
    handleFaceoffMiss(room, now);
  } else if (room.phase === "main") {
    setCue(room, "miss");
    setPhase(room, hiddenAnswers(room).length > 0 ? "steal-ready" : "round-reveal", now);
  } else if (room.phase === "steal") {
    setCue(room, "miss");
    setPhase(room, "round-reveal", now);
  }
}

function handleFaceoffMiss(room: FamilyFeudRoomState, now: number) {
  const round = room.round;
  if (!round || room.phase !== "faceoff" || round.faceoffTeamId === null) return false;
  if (!round.faceoffAttemptedTeamIds.includes(round.faceoffTeamId))
    round.faceoffAttemptedTeamIds.push(round.faceoffTeamId);
  setCue(room, "miss");
  if (round.faceoffAttemptedTeamIds.length >= 2) {
    if (room.suddenDeath) {
      beginRound(room, round.number, now, true);
      return true;
    }
    setPhase(room, "main-ready", now);
    return true;
  }
  round.faceoffTeamId = otherFamilyFeudTeam(round.faceoffTeamId);
  round.phaseStartedAt = now;
  round.phaseEndsAt = now + FAMILY_FEUD_FACE_OFF_SECONDS * 1_000;
  round.paused = false;
  changed(room, now);
  return true;
}

function scoreAnswer(room: FamilyFeudRoomState, answerId: string, now: number) {
  const round = room.round;
  const answerIndex = round?.answers.findIndex(({ id }) => id === answerId) ?? -1;
  const answer = round?.answers[answerIndex];
  if (!round || !answer || answerIndex < 0)
    return { code: "answer_unavailable" as const, error: "Answer unavailable" };
  if (answer.revealed)
    return { code: "already_revealed" as const, error: "That answer is already open" };
  let teamId: FamilyFeudTeamId;
  let points: number;
  if (room.phase === "practice") {
    answer.revealed = true;
    setCue(room, "correct");
    changed(room, now);
    return null;
  }
  if (room.phase === "faceoff" && round.faceoffTeamId) {
    teamId = round.faceoffTeamId;
    points = familyFeudBoardValue(answerIndex + 1);
  } else if (room.phase === "main") {
    teamId = round.activeTeamId;
    points = familyFeudBoardValue(answerIndex + 1);
  } else if (room.phase === "steal") {
    teamId = otherFamilyFeudTeam(round.activeTeamId);
    points = familyFeudBoardValue(answerIndex + 1) * 2;
  } else {
    return { code: "action_unavailable" as const, error: "Answers cannot be scored now" };
  }
  saveScoreUndo(room);
  answer.revealed = true;
  answer.awardedTeamId = teamId;
  answer.points = points;
  addPoints(room, teamId, points);
  setCue(room, "correct", { teamId, points });
  if (room.phase === "faceoff") {
    if (room.suddenDeath) setPhase(room, "round-reveal", now);
    else setPhase(room, "main-ready", now);
  } else if (room.phase === "steal" || hiddenAnswers(room).length === 0) {
    setPhase(room, "round-reveal", now);
  } else changed(room, now);
  return null;
}

function phaseAdvance(room: FamilyFeudRoomState, now: number) {
  if (room.phase === "rules") beginPractice(room, now);
  else if (room.phase === "practice") beginRound(room, 1, now);
  else if (room.phase === "round-intro" && room.round) {
    room.round.cardLocked = true;
    room.usedCardIds ??= [];
    if (!room.usedCardIds.includes(room.round.cardId)) room.usedCardIds.push(room.round.cardId);
    setPhase(room, "category", now);
  } else if (room.phase === "main-ready") {
    setCue(room, "open");
    setPhase(room, "main", now, room.mainSeconds);
  } else if (room.phase === "main")
    setPhase(room, hiddenAnswers(room).length > 0 ? "steal-ready" : "round-reveal", now);
  else if (room.phase === "steal-ready") {
    setCue(room, "steal");
    setPhase(room, "steal", now, room.stealSeconds);
  } else if (room.phase === "steal") {
    setCue(room, "miss");
    setPhase(room, "round-reveal", now);
  } else if (room.phase === "round-reveal") setPhase(room, "round-score", now);
  else if (room.phase === "round-score") {
    const round = room.round;
    if (!round) return false;
    if (room.suddenDeath) finish(room, now);
    else if (round.number < room.rounds) beginRound(room, round.number + 1, now);
    else if (team(room, "one").score === team(room, "two").score)
      beginRound(room, room.rounds + 1, now, true);
    else finish(room, now);
  } else return false;
  return true;
}

function officialResult(room: FamilyFeudRoomState): OfficialGameResultEnvelope | null {
  if (!room.officialResultChannelId || room.resultConfirmedAt === null) return null;
  const scores = { one: team(room, "one").score, two: team(room, "two").score };
  const placements = familyFeudPlacements(scores);
  return sealOfficialGameResult({
    channelId: room.officialResultChannelId,
    revision: 1,
    result: {
      gameKind: "family-feud",
      gameInstanceId: room.roomId,
      resultId: `game:${room.gameNumber}`,
      scope: "game",
      players: room.teams.flatMap((item) =>
        Array.from({ length: item.playerCount }, (_, index) => ({
          playerId: `team:${item.id}:slot:${index + 1}`,
          outcome: "completed" as const,
          rawScore: item.score,
          placement: placements[item.id].placement,
          won: placements[item.id].won,
        })),
      ),
    },
  });
}

async function deleteRoom(room: FamilyFeudRoomState, keys = familyFeudRoomRedisKeys(room.roomId)) {
  const redis = getRedis();
  if (redis) await redis.del(keys.state, keys.lock);
  else memoryRooms.delete(room.roomId);
}

async function loadRoom(roomId: string) {
  const keys = familyFeudRoomRedisKeys(roomId);
  const redis = getRedis();
  const room = redis
    ? await redis.get<FamilyFeudRoomState>(keys.state)
    : (memoryRooms.get(roomId) ?? null);
  if (!room) return null;
  if (room.expiresAt <= Date.now()) {
    await deleteRoom(room, keys);
    return null;
  }
  return { room, keys };
}

async function saveRoom(
  room: FamilyFeudRoomState,
  keys = familyFeudRoomRedisKeys(room.roomId),
  envelopes: OfficialGameResultEnvelope[] = [],
) {
  applyExpiry(room);
  const redis = getRedis();
  if (redis)
    return persistRoomWithOfficialResults({
      redis,
      stateKey: keys.state,
      room,
      ttlSeconds: remainingMultiplayerRoomTtlSeconds(room.expiresAt),
      envelopes,
    });
  memoryRooms.set(room.roomId, room);
  return envelopes.map((envelope) => ({ key: `memory:${envelope.payloadHash}`, envelope }));
}

async function withRoom<T>(
  roomId: string,
  use: (room: FamilyFeudRoomState, keys: RoomKeys) => T | Promise<T>,
): Promise<T | null> {
  const redis = getRedis();
  if (!redis) {
    const loaded = await loadRoom(roomId);
    if (!loaded) return null;
    const before = JSON.stringify(loaded.room);
    const wasConfirmed = loaded.room.resultConfirmedAt !== null;
    const result = await use(loaded.room, loaded.keys);
    const envelope =
      !wasConfirmed && loaded.room.resultConfirmedAt !== null ? officialResult(loaded.room) : null;
    const queued = multiplayerRoomStateChanged(before, loaded.room)
      ? await saveRoom(loaded.room, loaded.keys, envelope ? [envelope] : [])
      : [];
    publishOfficialResultsAfterCommit(queued);
    return result;
  }
  const initial = await loadRoom(roomId);
  if (!initial) return null;
  let queued: Array<{ key: string; envelope: OfficialGameResultEnvelope }> = [];
  const result = await withMultiplayerRoomLock(
    redis,
    { roomId, lockKey: initial.keys.lock, onAttempt: (attempt) => lockObserver?.(attempt) },
    async () => {
      const room = await redis.get<FamilyFeudRoomState>(initial.keys.state);
      if (!room || room.expiresAt <= Date.now()) return null;
      const before = JSON.stringify(room);
      const wasConfirmed = room.resultConfirmedAt !== null;
      const value = await use(room, initial.keys);
      if (multiplayerRoomStateChanged(before, room)) {
        const envelope =
          !wasConfirmed && room.resultConfirmedAt !== null ? officialResult(room) : null;
        queued = await saveRoom(room, initial.keys, envelope ? [envelope] : []);
      }
      return value;
    },
  );
  publishOfficialResultsAfterCommit(queued);
  return result;
}

function authenticate(room: FamilyFeudRoomState, role: FamilyFeudViewerRole, credential: string) {
  const expected =
    role === "controller"
      ? room.controllerHash
      : role === "presenter"
        ? room.presenterHash
        : room.buzzerHash;
  if (multiplayerCredentialsMatch(credential, expected)) return true;
  return role === "buzzer"
    ? Object.values(room.buzzerHashes ?? {}).some((hash) =>
        hash ? multiplayerCredentialsMatch(credential, hash) : false,
      )
    : false;
}

function buzzerTeamForCredential(room: FamilyFeudRoomState, credential: string) {
  for (const teamId of ["one", "two"] as const) {
    const hash = room.buzzerHashes?.[teamId];
    if (hash && multiplayerCredentialsMatch(credential, hash)) return teamId;
  }
  return multiplayerCredentialsMatch(credential, room.buzzerHash) ? "shared" : null;
}

export async function createFamilyFeudRoom(input: {
  deckId?: string;
  deckIds?: string[];
  vibeId?: FamilyFeudVibeId;
  adultContent?: boolean;
  customDeck?: FamilyFeudCustomDeckInput;
  customDecks?: FamilyFeudCustomDeckInput[];
  rounds?: number;
  mainSeconds?: number;
  stealSeconds?: number;
  firstTeamId?: FamilyFeudTeamId;
  teams?: Array<{ name?: string; playerCount?: number }>;
  officialResultChannelId?: string;
}): Promise<FamilyFeudRoomCredentials> {
  const rounds = boundedOption(input.rounds, FAMILY_FEUD_ROUND_OPTIONS, FAMILY_FEUD_DEFAULT_ROUNDS);
  const customInputs = [
    ...(input.customDeck ? [input.customDeck] : []),
    ...(input.customDecks ?? []),
  ].filter((deck, index, decks) => decks.findIndex(({ id }) => id === deck.id) === index);
  const customDecks = customInputs.map((deck) => {
    const cards = deck.cards.filter(validateFamilyFeudCard).map((card) => ({
      ...card,
      deckId: deck.id,
      deckName: deck.name,
      adultOnly: false,
    }));
    if (cards.length < 4) throw new Error("A custom deck needs four valid cards");
    return { id: deck.id, name: deck.name, cards };
  });
  const vibeId = input.vibeId ?? "choose-own";
  const selectedDeckIds = [
    ...new Set(
      input.deckIds?.length
        ? input.deckIds
        : input.customDeck
          ? [input.customDeck.id]
          : [input.deckId ?? "everyday-life"],
    ),
  ];
  const requestedDeckIds =
    input.vibeId && vibeId !== "choose-own" ? [...familyFeudVibe(vibeId).deckIds] : selectedDeckIds;
  const builtInDecks = familyFeudDecks(requestedDeckIds, Boolean(input.adultContent));
  const selectedCustomDecks = customDecks.filter(({ id }) => requestedDeckIds.includes(id));
  const availableDecks = [...builtInDecks, ...selectedCustomDecks];
  if (!availableDecks.length) {
    const fallback = familyFeudDeck("everyday-life");
    availableDecks.push(fallback);
    selectedDeckIds.splice(0, selectedDeckIds.length, fallback.id);
  }
  const deckById = new Map(availableDecks.map((deck) => [deck.id, deck]));
  const plannedDeckIds = familyFeudRoundDeckSequence({
    vibeId,
    selectedDeckIds,
    includeAdult: Boolean(input.adultContent),
    rounds,
  });
  const plannedDecks = plannedDeckIds.map(
    (deckId, index) => deckById.get(deckId) ?? availableDecks[index % availableDecks.length]!,
  );
  const roundCandidates = plannedDecks.map((deck) => shuffle(deck.cards));
  const cards = shuffle(availableDecks.flatMap((deck) => deck.cards));
  const selectionName = input.vibeId
    ? familyFeudVibe(vibeId).name
    : availableDecks.length === 1
      ? availableDecks[0]!.name
      : "Custom mix";
  const presenterToken = createMultiplayerCredential();
  const controllerPairingToken = createMultiplayerCredential();
  const buzzerToken = createMultiplayerCredential();
  const buzzerTokens = {
    one: createMultiplayerCredential(),
    two: createMultiplayerCredential(),
  } satisfies Record<FamilyFeudTeamId, string>;
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await loadRoom(candidate)),
  );
  const expiresAt = multiplayerLobbyExpiresAt(Date.now(), 1);
  const playerCounts = [0, 1].map((index) =>
    Math.max(1, Math.min(20, Math.trunc(input.teams?.[index]?.playerCount ?? 1))),
  );
  if (
    playerCounts[0] + playerCounts[1] < FAMILY_FEUD_PLAYER_LIMITS.min ||
    playerCounts[0] + playerCounts[1] > FAMILY_FEUD_PLAYER_LIMITS.max
  )
    throw new Error("Family Feud needs between 2 and 40 players");
  const room: FamilyFeudRoomState = {
    roomId,
    officialResultChannelId: input.officialResultChannelId,
    phase: "lobby",
    revision: 1,
    sequence: 1,
    expiresAt,
    presenterHash: hashMultiplayerCredential(presenterToken),
    controllerHash: hashMultiplayerCredential(createMultiplayerCredential()),
    controllerPairingHash: hashMultiplayerCredential(controllerPairingToken),
    controllerRecoveryHash: hashMultiplayerCredential(controllerPairingToken),
    buzzerHash: hashMultiplayerCredential(buzzerToken),
    buzzerHashes: {
      one: hashMultiplayerCredential(buzzerTokens.one),
      two: hashMultiplayerCredential(buzzerTokens.two),
    },
    lastControllerSeenAt: 0,
    gameNumber: 1,
    rounds,
    mainSeconds: boundedOption(
      input.mainSeconds,
      FAMILY_FEUD_MAIN_SECOND_OPTIONS,
      FAMILY_FEUD_DEFAULT_MAIN_SECONDS,
    ),
    stealSeconds: boundedOption(
      input.stealSeconds,
      FAMILY_FEUD_STEAL_SECOND_OPTIONS,
      FAMILY_FEUD_DEFAULT_STEAL_SECONDS,
    ),
    deckId: input.vibeId ? `vibe:${vibeId}` : availableDecks[0]!.id,
    deckName: selectionName,
    cards,
    cardCursor: 0,
    roundCandidates,
    roundCandidateCursors: Array.from({ length: rounds }, () => 0),
    usedCardIds: [],
    firstTeamId: input.firstTeamId ?? "one",
    teams: [
      {
        id: "one",
        marker: "circle",
        name: boundedName(input.teams?.[0]?.name, "Circle team"),
        playerCount: playerCounts[0],
        score: 0,
        roundPoints: 0,
      },
      {
        id: "two",
        marker: "triangle",
        name: boundedName(input.teams?.[1]?.name, "Triangle team"),
        playerCount: playerCounts[1],
        score: 0,
        roundPoints: 0,
      },
    ],
    round: null,
    suddenDeath: false,
    winnerTeamIds: [],
    resultConfirmedAt: null,
    claimDisplay: null,
    cue: null,
    processedActions: [],
    scoreUndo: [],
  };
  if (!getRedis() && process.env.NODE_ENV === "production")
    throw new Error("Family Feud rooms require Redis");
  await saveRoom(room);
  log.info("things.family-feud", "Room created", {
    deckId: room.deckId,
    rounds: room.rounds,
    playerCount: playerCounts[0] + playerCounts[1],
  });
  return {
    roomId,
    presenterToken,
    controllerPairingToken,
    buzzerToken,
    buzzerTokens,
    expiresAt,
  };
}

export async function pairFamilyFeudController(input: {
  roomId: string;
  pairingToken: string;
}): Promise<
  | { ok: true; controllerToken: string; expiresAt: number }
  | { ok: false; error: string; errorCode: "room_unavailable" | "pairing_used" }
> {
  const result = await withRoom(input.roomId, (room) => {
    const now = Date.now();
    const firstPair = Boolean(
      room.controllerPairingHash &&
      multiplayerCredentialsMatch(input.pairingToken, room.controllerPairingHash),
    );
    const recoveryPair = Boolean(
      room.controllerRecoveryHash &&
      multiplayerCredentialsMatch(input.pairingToken, room.controllerRecoveryHash),
    );
    if (!firstPair && (!recoveryPair || now - room.lastControllerSeenAt <= CONNECTED_WINDOW_MS))
      return {
        ok: false as const,
        error: recoveryPair
          ? "The current controller is still connected. Wait a moment, then scan again."
          : "This controller code is no longer valid",
        errorCode: "pairing_used" as const,
      };
    const controllerToken = createMultiplayerCredential();
    room.controllerHash = hashMultiplayerCredential(controllerToken);
    room.controllerPairingHash = null;
    room.lastControllerSeenAt = now;
    changed(room, now);
    return { ok: true as const, controllerToken, expiresAt: room.expiresAt };
  });
  return (
    result ?? {
      ok: false as const,
      error: "Room unavailable",
      errorCode: "room_unavailable" as const,
    }
  );
}

export async function readFamilyFeudSnapshot(input: {
  roomId: string;
  role: FamilyFeudViewerRole;
  credential: string;
  lastSequence?: number;
  lastDigest?: string | null;
}): Promise<FamilyFeudSnapshotResult> {
  const result = await withRoom(input.roomId, (room) => {
    if (!authenticate(room, input.role, input.credential)) return null;
    advanceTimedPhase(room);
    const now = Date.now();
    if (input.role === "controller" && now - room.lastControllerSeenAt > 8_000)
      room.lastControllerSeenAt = now;
    const current = snapshot(room, input.role);
    if (input.lastDigest && current.digest === input.lastDigest)
      return { ok: true as const, unchanged: true as const, serverNow: now, snapshot: null };
    return { ok: true as const, snapshot: current };
  });
  return (
    result ?? { ...multiplayerFailure("room_unavailable", "Room unavailable"), snapshot: null }
  );
}

export async function applyFamilyFeudControllerAction(input: {
  roomId: string;
  controllerToken: string;
  action: FamilyFeudControllerAction;
}): Promise<FamilyFeudActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    if (!authenticate(room, "controller", input.controllerToken)) return null;
    advanceTimedPhase(room);
    room.lastControllerSeenAt = Date.now();
    if (multiplayerActionSeen(room.processedActions, input.action.actionId))
      return accept(room, "controller");
    if (
      room.resultConfirmedAt !== null &&
      input.action.type !== "claim.display" &&
      input.action.type !== "game.replay"
    )
      return reject(room, "result_confirmed", "The confirmed result is locked");
    const now = Date.now();
    const round = room.round;
    const action = input.action;
    let handled = true;
    if (action.type === "game.start" && room.phase === "lobby") setPhase(room, "rules", now);
    else if (action.type === "phase.advance") handled = phaseAdvance(room, now);
    else if (
      (action.type === "card.skip" ||
        action.type === "card.next" ||
        action.type === "card.previous") &&
      room.phase === "round-intro" &&
      round
    ) {
      const direction = action.type === "card.previous" ? -1 : 1;
      room.round = roundFromCard(
        room,
        moveRoundCard(room, round.number, direction),
        round.number,
        round.total,
        now,
      );
      changed(room, now);
    } else if (action.type === "card.use" && room.phase === "round-intro" && round) {
      handled = phaseAdvance(room, now);
    } else if (
      action.type === "round.replace" &&
      round &&
      ["category", "faceoff", "main-ready", "main", "steal-ready", "steal"].includes(room.phase)
    ) {
      const hasAcceptedAnswer =
        round.answers.some(({ revealed }) => revealed) || round.houseAnswers.length > 0;
      if (hasAcceptedAnswer)
        return reject(room, "action_unavailable", "This round is locked because an answer is open");
      room.usedCardIds = (room.usedCardIds ?? []).filter((cardId) => cardId !== round.cardId);
      room.round = roundFromCard(
        room,
        moveRoundCard(room, round.number, 1),
        round.number,
        round.total,
        now,
      );
      room.phase = "round-intro";
      room.cue = null;
      changed(room, now);
    } else if (action.type === "faceoff.open" && room.phase === "category" && round) {
      round.faceoffTeamId = null;
      round.faceoffAttemptedTeamIds = [];
      setPhase(room, "faceoff", now);
    } else if (action.type === "faceoff.claim" && room.phase === "faceoff" && round) {
      if (round.faceoffTeamId !== null)
        return reject(
          room,
          "buzzers_closed",
          `${team(room, round.faceoffTeamId).name} buzzed first`,
        );
      round.faceoffTeamId = action.teamId;
      setCue(room, "buzz");
      round.phaseStartedAt = now;
      round.phaseEndsAt = now + FAMILY_FEUD_FACE_OFF_SECONDS * 1_000;
      changed(room, now);
    } else if (action.type === "faceoff.miss") handled = handleFaceoffMiss(room, now);
    else if (action.type === "answer.reveal") {
      const error = scoreAnswer(room, action.answerId, now);
      if (error) return reject(room, error.code, error.error);
    } else if (action.type === "answer.hide" && round) {
      const answer = round.answers.find(({ id }) => id === action.answerId);
      if (!answer?.revealed) return reject(room, "answer_unavailable", "That answer is not open");
      saveScoreUndo(room);
      if (answer.awardedTeamId && answer.points)
        addPoints(room, answer.awardedTeamId, -answer.points);
      answer.revealed = false;
      answer.awardedTeamId = undefined;
      answer.points = undefined;
      if (room.phase === "finished") refreshWinnerTeamIds(room);
      changed(room, now);
    } else if (action.type === "answer.reassign" && round) {
      const answer = round.answers.find(({ id }) => id === action.answerId);
      if (!answer?.revealed || !answer.awardedTeamId || !answer.points)
        return reject(room, "answer_unavailable", "That answer has no points to move");
      if (answer.awardedTeamId !== action.teamId) {
        saveScoreUndo(room);
        addPoints(room, answer.awardedTeamId, -answer.points);
        addPoints(room, action.teamId, answer.points);
        answer.awardedTeamId = action.teamId;
        if (room.phase === "finished") refreshWinnerTeamIds(room);
        changed(room, now);
      }
    } else if (action.type === "steal.miss" && room.phase === "steal") {
      setCue(room, "miss");
      setPhase(room, "round-reveal", now);
    } else if (action.type === "timer.pause" && round && round.phaseEndsAt > now && !round.paused) {
      round.pausedRemainingMs = round.phaseEndsAt - now;
      round.phaseEndsAt = 0;
      round.paused = true;
      changed(room, now);
    } else if (action.type === "timer.resume" && round?.paused) {
      round.phaseEndsAt = now + round.pausedRemainingMs;
      round.pausedRemainingMs = 0;
      round.paused = false;
      changed(room, now);
    } else if (action.type === "timer.reset" && round) {
      const seconds =
        room.phase === "main"
          ? room.mainSeconds
          : room.phase === "steal"
            ? room.stealSeconds
            : room.phase === "faceoff"
              ? FAMILY_FEUD_FACE_OFF_SECONDS
              : 0;
      if (!seconds) handled = false;
      else {
        round.phaseStartedAt = now;
        round.phaseEndsAt = now + seconds * 1_000;
        round.pausedRemainingMs = 0;
        round.paused = false;
        changed(room, now);
      }
    } else if (action.type === "score.adjust") {
      if (!Number.isInteger(action.points) || action.points === 0 || Math.abs(action.points) > 10)
        return reject(room, "action_unavailable", "Choose a score adjustment from -10 to 10");
      saveScoreUndo(room);
      addPoints(room, action.teamId, action.points);
      if (room.phase === "finished") refreshWinnerTeamIds(room);
      changed(room, now);
    } else if (action.type === "house-answer.add" && round) {
      if (
        !["faceoff", "main", "steal"].includes(room.phase) ||
        (room.phase === "faceoff" && round.faceoffTeamId === null)
      )
        return reject(room, "action_unavailable", "House answers cannot be scored now");
      const label = action.label.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, 48);
      if (!label) return reject(room, "answer_unavailable", "Add the accepted answer");
      const existingAnswer = round.answers.find((answer) => familyFeudAnswerMatches(answer, label));
      if (existingAnswer) {
        const error = scoreAnswer(room, existingAnswer.id, now);
        if (error) return reject(room, error.code, error.error);
      } else {
        const normalizedLabel = normaliseFamilyFeudAnswer(label);
        if (
          round.houseAnswers.some(
            (answer) => normaliseFamilyFeudAnswer(answer.label) === normalizedLabel,
          )
        )
          return reject(room, "already_revealed", "That house answer is already open");
        const targetTeam =
          action.teamId ??
          (room.phase === "steal"
            ? otherFamilyFeudTeam(round.activeTeamId)
            : room.phase === "faceoff" && round.faceoffTeamId
              ? round.faceoffTeamId
              : round.activeTeamId);
        const points = room.phase === "steal" ? 2 : 1;
        saveScoreUndo(room);
        round.houseAnswers.push({
          id: `house:${room.sequence + 1}:${round.houseAnswers.length + 1}`,
          label,
          teamId: targetTeam,
          points,
        });
        addPoints(room, targetTeam, points);
        setCue(room, "correct", { teamId: targetTeam, points });
        if (room.phase === "faceoff")
          setPhase(room, room.suddenDeath ? "round-reveal" : "main-ready", now);
        else if (room.phase === "steal") setPhase(room, "round-reveal", now);
        else changed(room, now);
      }
    } else if (action.type === "undo.last") {
      if (!restoreScoreUndo(room)) handled = false;
      else changed(room, now);
    } else if (action.type === "game.end" && room.phase !== "finished") finish(room, now);
    else if (
      action.type === "sudden-death.start" &&
      room.phase === "finished" &&
      room.resultConfirmedAt === null &&
      room.winnerTeamIds.length > 1
    ) {
      room.winnerTeamIds = [];
      beginRound(room, room.rounds + 1, now, true);
    } else if (action.type === "result.confirm" && room.phase === "finished") {
      refreshWinnerTeamIds(room);
      if (room.winnerTeamIds.length > 1)
        return reject(room, "action_unavailable", "A tie needs a sudden-death answer first");
      room.resultConfirmedAt = now;
      changed(room, now);
    } else if (action.type === "claim.display" && room.phase === "finished") {
      room.claimDisplay = action.display;
      changed(room, now);
    } else if (action.type === "game.replay" && room.phase === "finished") {
      room.gameNumber += 1;
      room.phase = "rules";
      room.round = null;
      room.suddenDeath = false;
      room.winnerTeamIds = [];
      room.resultConfirmedAt = null;
      room.claimDisplay = null;
      room.scoreUndo = [];
      room.usedCardIds = [];
      room.roundCandidateCursors = Array.from({ length: room.rounds }, () => 0);
      room.roundCandidates = room.roundCandidates?.map((candidates) => shuffle(candidates));
      for (const item of room.teams) {
        item.score = 0;
        item.roundPoints = 0;
      }
      changed(room, now);
    } else handled = false;
    if (!handled) return reject(room, "action_unavailable", "That action is not available now");
    room.processedActions = rememberMultiplayerAction(room.processedActions, action.actionId);
    return accept(room, "controller");
  });
  return result ?? actionFailure("room_unavailable", "Room unavailable");
}

export async function applyFamilyFeudBuzzerAction(input: {
  roomId: string;
  buzzerToken: string;
  action: FamilyFeudBuzzerAction;
}): Promise<FamilyFeudActionResult> {
  const result = await withRoom(input.roomId, (room) => {
    const buzzerTeam = buzzerTeamForCredential(room, input.buzzerToken);
    if (!buzzerTeam) return null;
    advanceTimedPhase(room);
    if (multiplayerActionSeen(room.processedActions, input.action.actionId))
      return accept(room, "buzzer");
    const round = room.round;
    if (room.phase !== "faceoff" || !round || round.faceoffTeamId !== null)
      return reject(room, "buzzers_closed", "Buzzers are closed", "buzzer");
    if (buzzerTeam !== "shared" && buzzerTeam !== input.action.teamId)
      return reject(room, "action_unavailable", "That buzzer belongs to the other team", "buzzer");
    const now = Date.now();
    round.faceoffTeamId = input.action.teamId;
    setCue(room, "buzz");
    round.phaseStartedAt = now;
    round.phaseEndsAt = now + FAMILY_FEUD_FACE_OFF_SECONDS * 1_000;
    room.processedActions = rememberMultiplayerAction(room.processedActions, input.action.actionId);
    changed(room, now);
    return accept(room, "buzzer");
  });
  return result ?? actionFailure("room_unavailable", "Room unavailable");
}

export async function authorizeFamilyFeudSocket(input: {
  roomId: string;
  role: FamilyFeudViewerRole;
  credential: string;
}) {
  const loaded = await loadRoom(input.roomId);
  return Boolean(loaded && authenticate(loaded.room, input.role, input.credential));
}

export async function closeFamilyFeudRoom(roomId: string, controllerToken: string) {
  const loaded = await loadRoom(roomId);
  if (!loaded) return { ok: true };
  if (!authenticate(loaded.room, "controller", controllerToken)) return { ok: false };
  await deleteRoom(loaded.room, loaded.keys);
  log.info("things.family-feud", "Room closed", { phase: loaded.room.phase });
  return { ok: true };
}
