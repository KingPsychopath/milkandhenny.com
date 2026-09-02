import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { MAX_TRANSFER_FILES } from "@/features/transfers/store.server";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { getUploadUrlTtlSeconds } from "@/features/transfers/upload-window.server";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

export const runtime = "nodejs";

async function handlePOST(request: Request) {
  const { error: authError, payload } = await requireAuthWithPayload(request, "upload");
  if (authError) return authError;

  let body: {
    transferId?: string;
    deleteToken?: string;
    files?: TransferUploadFileInput[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.transferId || !body.deleteToken) {
    return Response.json({ error: "Missing transfer recovery details" }, { status: 400 });
  }
  if (
    !Array.isArray(body.files) ||
    body.files.length === 0 ||
    body.files.length > MAX_TRANSFER_FILES
  ) {
    return Response.json({ error: "Invalid recovery file list" }, { status: 400 });
  }
  if (!payload?.jti) {
    return Response.json(
      { error: "Authenticated upload session is missing an ID" },
      { status: 401 },
    );
  }

  try {
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.resumeUpload({
          transferId: body.transferId!,
          deleteToken: body.deleteToken!,
          actorJti: payload.jti,
          files: body.files!,
          uploadUrlTtlSeconds: getUploadUrlTtlSeconds(),
        });
      }),
      request.signal,
    );
    if (result.status === "missing-reservation") {
      return Response.json({ error: "That interrupted upload has expired" }, { status: 410 });
    }
    if (result.status === "reservation-mismatch") {
      return Response.json(
        { error: "Those files do not match the interrupted upload" },
        { status: 409 },
      );
    }
    return Response.json(result);
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "upload.resume",
      "Could not recover the interrupted upload. Please try again.",
      error,
      { transferId: body.transferId, fileCount: body.files.length },
    );
  }
}

export const Route = createFileRoute("/api/upload/transfer/resume")({
  server: { handlers: { POST: ({ request }) => handlePOST(request) } },
});

export { handlePOST as POST };
