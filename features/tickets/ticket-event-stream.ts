export type TicketStreamEvent = { kind: "ready" | "checked-in" | "unchecked-in" | "unavailable" };
type Listener = (event: TicketStreamEvent) => void;

export function subscribeTicketStream(ticketId: string, listener: Listener): () => void {
  const source = new EventSource(`/api/tickets/${encodeURIComponent(ticketId)}/arrival/events`);
  for (const kind of ["ready", "checked-in", "unchecked-in", "unavailable"] as const) {
    source.addEventListener(kind, () => listener({ kind }));
  }
  return () => source.close();
}
