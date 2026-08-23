import { PITCH_DEFAULT_MAX_SLIDES, PITCH_SLIDE_LIMIT_RANGE } from "./types";

function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function getPitchMaxSlides(): number {
  return boundedInteger(
    process.env.PITCH_MAX_SLIDES,
    PITCH_DEFAULT_MAX_SLIDES,
    PITCH_SLIDE_LIMIT_RANGE.min,
    PITCH_SLIDE_LIMIT_RANGE.max,
  );
}

export function getPitchMaxDecksPerEmail(): number {
  return boundedInteger(process.env.PITCH_MAX_DECKS_PER_EMAIL, 3, 1, 10);
}

export function getPitchDraftTtlHours(): number {
  return boundedInteger(process.env.PITCH_DRAFT_TTL_HOURS, 48, 12, 168);
}

export function getPitchDraftExpiresAt(now = Date.now()): string {
  return new Date(now + getPitchDraftTtlHours() * 60 * 60 * 1_000).toISOString();
}

export const PITCH_BACKUP_INTERVAL_MS = 5 * 60 * 1_000;
export const PITCH_BACKUP_KEEP_COUNT = 20;
export const PITCH_PUBLISHED_BACKUP_KEEP_COUNT = 10;
export const PITCH_COMMAND_RETENTION_DAYS = 30;
export const PITCH_TRASH_RETENTION_DAYS = 30;
