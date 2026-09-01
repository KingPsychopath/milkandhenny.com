import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { toPublicTransfer } from "@/features/transfers/public";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>;
};

async function handleDELETE(request: Request, context: RouteContext) {
  const { id, fileId } = await context.params;

  let token: string | null = null;
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : null;
  } catch {
    return Response.json({ error: "Request body must include { token: string }" }, { status: 400 });
  }

  if (!token) {
    return Response.json({ error: "Delete token is required" }, { status: 400 });
  }

  try {
    const removal = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.removeFile({ id, fileId, token });
      }),
      request.signal,
    );
    if (removal.status === "unauthorised") {
      return Response.json(
        { error: "Invalid delete token or transfer not found" },
        { status: 403 },
      );
    }
    if (removal.status === "missing") {
      return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
    }
    if (removal.status === "file-missing") {
      return Response.json({ error: "File not found in transfer" }, { status: 404 });
    }
    if (removal.status === "deleted") {
      return Response.json({
        success: true,
        deletedObjects: removal.deletedObjects,
        deletedTransfer: true,
        dataDeleted: true,
        deletedFileId: fileId,
      });
    }
    const publicTransfer = toPublicTransfer(removal.transfer);

    return Response.json({
      success: true,
      deletedObjects: removal.deletedObjects,
      deletedTransfer: false,
      deletedFileId: fileId,
      transfer: {
        id: publicTransfer.id,
        title: publicTransfer.title,
        files: publicTransfer.files,
        groups: publicTransfer.groups,
        createdAt: publicTransfer.createdAt,
        expiresAt: publicTransfer.expiresAt,
      },
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "transfers.remove-file",
      "Failed to remove transfer file",
      error,
      { id, fileId },
    );
  }
}

export const Route = createFileRoute("/api/transfers/$id/files/$fileId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});

export { handleDELETE as DELETE };
