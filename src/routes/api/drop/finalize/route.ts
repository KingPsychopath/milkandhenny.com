import { createFileRoute } from "@tanstack/react-router";

import { appendFinalize } from "@/features/transfers/append.server";
import { resolveDropToken } from "@/features/events/drop.server";

export const maxDuration = 15;
export const runtime = "nodejs";

const GUEST_MAX_FILES = 30;
const GUEST_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** Guest drop finalize — same bearer authorisation as presign. */
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

  return appendFinalize(request, drop.transferId, body.files, {
    maxFiles: GUEST_MAX_FILES,
    maxFileBytes: GUEST_MAX_FILE_BYTES,
  });
}

export const Route = createFileRoute("/api/drop/finalize")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
