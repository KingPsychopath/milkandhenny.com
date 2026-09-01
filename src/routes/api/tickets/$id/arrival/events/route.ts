import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { openedTicketForReference } from "@/features/event-scoring/session.server";
import { EventsRealtimeService } from "@/features/events/events-resources.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

const KEEPALIVE_MS = 25_000;

async function handleGET(request: Request, reference: string) {
  try {
    const access = await openedTicketForReference(reference);
    if (!access) return Response.json({ error: "Open this ticket first" }, { status: 404 });
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          if (keepalive) clearInterval(keepalive);
          try {
            controller.close();
          } catch {
            // Runtime already closed the request.
          }
        };
        const send = (value: string) => {
          if (!closed) controller.enqueue(encoder.encode(value));
        };
        request.signal.addEventListener("abort", close, { once: true });
        try {
          unsubscribe = await runEventsEffect(
            Effect.gen(function* () {
              const realtime = yield* EventsRealtimeService;
              return yield* realtime.subscribeTicket(access.eventSlug, access.ticketId, (event) =>
                send(`event: ${event.kind}\ndata: {}\n\n`),
              );
            }),
            request.signal,
          );
          send("event: ready\ndata: {}\n\n");
          keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
          keepalive.unref?.();
        } catch {
          send("event: unavailable\ndata: {}\n\n");
          close();
        }
      },
      cancel() {
        unsubscribe?.();
        if (keepalive) clearInterval(keepalive);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "tickets.arrival-events",
      "Could not open check-in updates",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/arrival/events")({
  server: { handlers: { GET: ({ request, params }) => handleGET(request, params.id) } },
});

export { handleGET as GET };
