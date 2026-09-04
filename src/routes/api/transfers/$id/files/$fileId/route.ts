import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { requireAuth } from "@/features/auth/auth.server";
import { toPublicTransfer } from "@/features/transfers/public";
import {
  TransferOperationsService,
  type AuthorisedTransferFileRemovalResult,
  type TransferFileRemovalResult,
} from "@/features/transfers/transfer-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { requestOwnsTransfer } from "@/features/transfers/upload-access.server";

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
    // Admin-cookie requests do not need a body.
  }

  try {
    const ownerRemoval: TransferFileRemovalResult = token
      ? await runMediaEffect(
          Effect.gen(function* () {
            const transfers = yield* TransferOperationsService;
            return yield* transfers.removeFile({ id, fileId, token });
          }),
          request.signal,
        )
      : ({ status: "unauthorised" } as const);

    let removal: AuthorisedTransferFileRemovalResult;
    if (ownerRemoval.status === "unauthorised") {
      const accountOwner = await requestOwnsTransfer(request, id);
      if (!accountOwner) {
        const authErr = await requireAuth(request, "admin");
        if (authErr) return authErr;
      }
      removal = await runMediaEffect(
        Effect.gen(function* () {
          const transfers = yield* TransferOperationsService;
          return yield* transfers.adminRemoveFile({ id, fileId });
        }),
        request.signal,
      );
    } else {
      removal = ownerRemoval;
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
