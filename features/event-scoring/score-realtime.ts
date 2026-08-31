export const SCORE_REALTIME_CHANNEL = "event_scoring_realtime";

export type ScoreRealtimeEvent = {
  eventSlug: string;
  transactionId: string;
  participantIds?: string[];
};

export function parseScoreRealtimeEvent(value: unknown): ScoreRealtimeEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.eventSlug !== "string" || typeof record.transactionId !== "string") return null;
  if (
    record.participantIds !== undefined &&
    (!Array.isArray(record.participantIds) ||
      !record.participantIds.every((participantId) => typeof participantId === "string"))
  ) {
    return null;
  }
  return {
    eventSlug: record.eventSlug,
    transactionId: record.transactionId,
    participantIds: record.participantIds,
  };
}

export function scoreRealtimePayload(event: ScoreRealtimeEvent): string {
  const full = JSON.stringify(event);
  // PostgreSQL NOTIFY payloads are limited to 8 kB. An event-wide wake is
  // still safe because every client reconciles its own authoritative snapshot.
  return new TextEncoder().encode(full).byteLength < 7_900
    ? full
    : JSON.stringify({ eventSlug: event.eventSlug, transactionId: event.transactionId });
}
