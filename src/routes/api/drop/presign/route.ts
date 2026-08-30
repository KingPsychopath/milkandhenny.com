import { createFileRoute } from "@tanstack/react-router";

import { appendPresign } from "@/features/transfers/append.server";
import { resolveDropToken } from "@/features/events/drop.server";
import { MAX_TRANSFER_TOTAL_BYTES } from "@/features/transfers/store.server";

export const runtime = "nodejs";

/** Guests upload in reasonable batches, not archive dumps. */
const GUEST_MAX_FILES = 30;
const GUEST_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Guest drop presign. The bearer token is the whole authorisation and maps
 * to exactly one transfer — the client never names a transfer id.
 */
async function handlePOST(request: Request) {
  let body: { token?: string; files?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const drop = await resolveDropToken(body.token ?? "");
  if (!drop) {
    return Response.json({ error: "This upload link is no longer active" }, { status: 404 });
  }

  return appendPresign(request, drop.transferId, body.files, {
    maxFiles: GUEST_MAX_FILES,
    maxFileBytes: GUEST_MAX_FILE_BYTES,
    maxTotalBytes: MAX_TRANSFER_TOTAL_BYTES,
  });
}

export const Route = createFileRoute("/api/drop/presign")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
