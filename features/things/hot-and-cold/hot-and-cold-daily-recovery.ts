import { hotAndColdBrowserKeys } from "./hot-and-cold-keys";
import type { SoloHotAndColdGuess } from "./types";

export interface SavedDailyHotAndColdState {
  puzzle: number;
  guesses: SoloHotAndColdGuess[];
  target: string | null;
  gaveUp: boolean;
  hintsUsed: number;
  judgingVersion: string | null;
  runId: string | null;
  resultRecorded: boolean;
}

export interface SavedDailyHotAndColdCandidate {
  key: string;
  state: SavedDailyHotAndColdState;
  needsReplay: boolean;
}

function finiteInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)
    ? value
    : fallback;
}

function parseGuess(value: unknown, index: number): SoloHotAndColdGuess | null {
  if (!value || typeof value !== "object") return null;
  const guess = value as Record<string, unknown>;
  if (typeof guess.word !== "string" || !guess.word) return null;
  return {
    word: guess.word,
    rank: finiteInteger(guess.rank, Number.MAX_SAFE_INTEGER),
    band:
      guess.band === "found" ||
      guess.band === "burning" ||
      guess.band === "hot" ||
      guess.band === "warm" ||
      guess.band === "cool" ||
      guess.band === "cold" ||
      guess.band === "frozen"
        ? guess.band
        : "frozen",
    sequence: finiteInteger(guess.sequence, index + 1),
    createdAt: finiteInteger(guess.createdAt, index),
    ...(guess.hint === true ? { hint: true } : {}),
  };
}

function parseState(raw: string | null, puzzle: number): SavedDailyHotAndColdState | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const saved = value as Record<string, unknown>;
    if (saved.puzzle !== undefined && finiteInteger(saved.puzzle, -1) !== puzzle) return null;
    const guesses = Array.isArray(saved.guesses)
      ? saved.guesses
          .slice(0, 256)
          .map(parseGuess)
          .filter((guess): guess is SoloHotAndColdGuess => guess !== null)
      : [];
    const runId =
      typeof saved.runId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.runId)
        ? saved.runId
        : null;
    return {
      puzzle,
      guesses,
      target: typeof saved.target === "string" && saved.target ? saved.target : null,
      gaveUp: saved.gaveUp === true,
      hintsUsed: Math.max(
        0,
        Math.min(3, finiteInteger(saved.hintsUsed, guesses.filter(({ hint }) => hint).length)),
      ),
      judgingVersion: typeof saved.judgingVersion === "string" ? saved.judgingVersion : null,
      runId,
      resultRecorded: saved.resultRecorded === true,
    };
  } catch {
    return null;
  }
}

function revisionFromKey(key: string, puzzle: number) {
  const prefix = `${hotAndColdBrowserKeys.dailyPrefix()}:`;
  const suffix = `:${puzzle}`;
  if (!key.startsWith(prefix) || !key.endsWith(suffix)) return null;
  const revision = key.slice(prefix.length, -suffix.length);
  return revision && !revision.includes(":") ? revision : null;
}

function candidateKeys(storage: Storage, puzzle: number, judgingVersion: string) {
  const keys = new Set([
    hotAndColdBrowserKeys.daily(puzzle, judgingVersion),
    hotAndColdBrowserKeys.legacyDaily(puzzle),
  ]);
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && revisionFromKey(key, puzzle)) keys.add(key);
  }
  return [...keys];
}

function progress(candidate: SavedDailyHotAndColdCandidate, currentKey: string) {
  const latestGuess = candidate.state.guesses.reduce(
    (latest, guess) => Math.max(latest, guess.createdAt),
    0,
  );
  return [
    candidate.state.target ? 1 : 0,
    candidate.state.guesses.length,
    latestGuess,
    candidate.key === currentKey ? 1 : 0,
  ] as const;
}

function isBetter(
  candidate: SavedDailyHotAndColdCandidate,
  current: SavedDailyHotAndColdCandidate,
  currentKey: string,
) {
  const left = progress(candidate, currentKey);
  const right = progress(current, currentKey);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

export function recoverDailyHotAndColdState(
  storage: Storage,
  puzzle: number,
  judgingVersion: string,
): SavedDailyHotAndColdCandidate | null {
  const currentKey = hotAndColdBrowserKeys.daily(puzzle, judgingVersion);
  let best: SavedDailyHotAndColdCandidate | null = null;
  for (const key of candidateKeys(storage, puzzle, judgingVersion)) {
    const state = parseState(storage.getItem(key), puzzle);
    if (!state) continue;
    const keyRevision = revisionFromKey(key, puzzle);
    const candidate = {
      key,
      state,
      needsReplay:
        key !== currentKey ||
        keyRevision !== judgingVersion ||
        state.judgingVersion !== judgingVersion,
    };
    if (!best || isBetter(candidate, best, currentKey)) best = candidate;
  }
  return best;
}
