export type ScoreStreamEvent = {
  kind: "ready" | "score" | "unavailable";
  transactionId?: string;
};
type ScoreStreamListener = (event: ScoreStreamEvent) => void;
type SharedStream = { source: EventSource; listeners: Set<ScoreStreamListener> };

const streams = new Map<string, SharedStream>();

export function subscribeScoreStream(ticketId: string, listener: ScoreStreamListener): () => void {
  let stream = streams.get(ticketId);
  if (!stream) {
    const source = new EventSource(`/api/tickets/${encodeURIComponent(ticketId)}/score/events`);
    stream = { source, listeners: new Set<ScoreStreamListener>() };
    streams.set(ticketId, stream);
    for (const kind of ["ready", "score", "unavailable"] as const) {
      source.addEventListener(kind, (event) => {
        let transactionId: string | undefined;
        if (kind === "score" && event instanceof MessageEvent) {
          try {
            const parsed: unknown = JSON.parse(event.data as string);
            const candidate =
              parsed && typeof parsed === "object"
                ? (parsed as { transactionId?: unknown }).transactionId
                : undefined;
            if (typeof candidate === "string") transactionId = candidate;
          } catch {
            // A malformed wake-up still triggers durable reconciliation.
          }
        }
        for (const current of streams.get(ticketId)?.listeners ?? []) {
          current({ kind, transactionId });
        }
      });
    }
  }
  stream.listeners.add(listener);
  return () => {
    const current = streams.get(ticketId);
    current?.listeners.delete(listener);
    if (current?.listeners.size === 0) {
      current.source.close();
      streams.delete(ticketId);
    }
  };
}
