import { createFileRoute } from "@tanstack/react-router";
import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { appendFinalize } from "@/features/transfers/append.server";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";

export const maxDuration = 15;
export const runtime = "nodejs";

/** Admin append: record uploaded files on an existing transfer. */
async function handlePOST(request: Request) {
  const { error: authErr } = await requireAuthWithPayload(request, "admin");
  if (authErr) return authErr;

  let body: { transferId?: string; files?: TransferUploadFileInput[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transferId = body.transferId?.trim();
  if (!transferId) return Response.json({ error: "Missing transferId" }, { status: 400 });

  return appendFinalize(request, transferId, body.files);
}

export const Route = createFileRoute("/api/upload/transfer/append/finalize")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});
