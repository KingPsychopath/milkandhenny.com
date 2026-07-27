import { createFileRoute } from "@tanstack/react-router";
import { subscribeToTransferMediaEvents } from "@/features/transfers/media-events.server";
import { toPublicTransferFile } from "@/features/transfers/public";
import { getTransfer } from "@/features/transfers/store.server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Proxies and load balancers drop idle connections; a comment line is not an event. */
const KEEPALIVE_INTERVAL_MS = 25_000;

/**
 * GET /api/transfers/[id]/events
 *
 * Server-sent events for one transfer's media processing. A file queued for
 * the worker arrives as `original_only`, then this stream delivers `processing`
 * and finally `ready` with its poster — so a video's thumbnail appears on its
 * own, with no polling and no refresh.
 *
 * Access matches the transfer page itself: knowing an unexpired transfer id is
 * the credential, and only public file fields are sent.
 */
async function handleGET(request: Request, context: RouteContext) {
  const { id } = await context.params;

  const transfer = await getTransfer(id);
  if (!transfer) {
    return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
  }
  if (new Date(transfer.expiresAt).getTime() <= Date.now()) {
    return Response.json({ error: "Transfer has expired" }, { status: 410 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

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
          // Already closed by the runtime.
        }
      };

      request.signal.addEventListener("abort", cleanup);

      send(": connected\n\n");

      try {
        unsubscribe = await subscribeToTransferMediaEvents(id, (event) => {
          send(
            `event: file\ndata: ${JSON.stringify({
              file: toPublicTransferFile(event.file),
              at: event.at,
            })}\n\n`,
          );
        });
      } catch {
        // Without a backplane there is nothing to stream. Close cleanly and let
        // the client fall back to reloading the transfer.
        send("event: unavailable\ndata: {}\n\n");
        cleanup();
        return;
      }

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
    },
  });
}

export const Route = createFileRoute("/api/transfers/$id/events")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, { params: Promise.resolve(params) }),
    },
  },
});

export { handleGET as GET };
