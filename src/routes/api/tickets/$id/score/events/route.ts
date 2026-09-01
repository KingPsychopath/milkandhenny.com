import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { openedTicketForReference } from "@/features/event-scoring/session.server";
import { EventsRealtimeService } from "@/features/events/events-resources.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

const KEEPALIVE_INTERVAL_MS = 25_000;

async function handleGET(request: Request, ticketId: string) {
  try {
    const access = await openedTicketForReference(ticketId, "scoring");
    if (!access) {
      return Response.json(
        { error: "Open this ticket for scoring on the device first" },
        { status: 404 },
      );
    }
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let keepalive: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const cleanup = () => {
          if (closed) return;
          closed = true;
          unsubscribe?.();
          unsubscribe = null;
          if (keepalive) clearInterval(keepalive);
          keepalive = null;
          try {
            controller.close();
          } catch {
            // The runtime already closed the response.
          }
        };
        const send = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            cleanup();
          }
        };
        request.signal.addEventListener("abort", cleanup, { once: true });
        try {
          unsubscribe = await runEventsEffect(
            Effect.gen(function* () {
              const realtime = yield* EventsRealtimeService;
              return yield* realtime.subscribeScore(
                access.eventSlug,
                access.participantId,
                (event) => {
                  send(
                    `id: ${event.transactionId}\nevent: score\ndata: ${JSON.stringify({ transactionId: event.transactionId })}\n\n`,
                  );
                },
              );
            }),
            request.signal,
          );
        } catch {
          send("event: unavailable\ndata: {}\n\n");
          cleanup();
          return;
        }
        send("event: ready\ndata: {}\n\n");
        keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_INTERVAL_MS);
        keepalive.unref?.();
        if (request.signal.aborted) cleanup();
      },
      cancel() {
        unsubscribe?.();
        unsubscribe = null;
        if (keepalive) clearInterval(keepalive);
        keepalive = null;
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
      "event-scoring.events",
      "Could not open score updates",
      error,
    );
  }
}

export const Route = createFileRoute("/api/tickets/$id/score/events")({
  server: { handlers: { GET: ({ request, params }) => handleGET(request, params.id) } },
});

export { handleGET as GET };
