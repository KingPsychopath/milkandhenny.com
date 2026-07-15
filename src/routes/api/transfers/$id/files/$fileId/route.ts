import { createFileRoute } from "@tanstack/react-router";
import { getTransferFileDeleteKeys } from "@/features/transfers/delete";
import {
  deleteTransferData,
  getTransfer,
  removeTransferFile,
  saveTransfer,
  validateDeleteToken,
} from "@/features/transfers/store.server";
import { deleteObjects, isTransferStorageConfigured } from "@/lib/platform/r2.server";

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>;
};

async function handleDELETE(request: Request, context: RouteContext) {
  const { id, fileId } = await context.params;

  let token: string | null = null;
  try {
    const body = await request.json();
    token = body?.token ?? null;
  } catch {
    return Response.json({ error: "Request body must include { token: string }" }, { status: 400 });
  }

  if (!token) {
    return Response.json({ error: "Delete token is required" }, { status: 400 });
  }

  const valid = await validateDeleteToken(id, token);
  if (!valid) {
    return Response.json({ error: "Invalid delete token or transfer not found" }, { status: 403 });
  }

  const transfer = await getTransfer(id);
  if (!transfer) {
    return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
  }

  const file = transfer.files.find((candidate) => candidate.id === fileId);
  if (!file) {
    return Response.json({ error: "File not found in transfer" }, { status: 404 });
  }

  let deletedObjects = 0;
  if (isTransferStorageConfigured()) {
    const keys = getTransferFileDeleteKeys(id, file);
    deletedObjects = keys.length > 0 ? await deleteObjects(keys) : 0;
  }

  const updatedTransfer = removeTransferFile(transfer, fileId);
  if (updatedTransfer.files.length === 0) {
    const dataDeleted = await deleteTransferData(id);
    return Response.json({
      success: true,
      deletedObjects,
      deletedTransfer: true,
      dataDeleted,
      deletedFileId: fileId,
    });
  }

  const remainingTtlSeconds = Math.floor(
    (new Date(transfer.expiresAt).getTime() - Date.now()) / 1000,
  );
  if (remainingTtlSeconds <= 0) {
    return Response.json({ error: "Transfer has already expired" }, { status: 410 });
  }

  await saveTransfer(updatedTransfer, remainingTtlSeconds);

  return Response.json({
    success: true,
    deletedObjects,
    deletedTransfer: false,
    deletedFileId: fileId,
    transfer: {
      id: updatedTransfer.id,
      title: updatedTransfer.title,
      files: updatedTransfer.files,
      groups: updatedTransfer.groups,
      createdAt: updatedTransfer.createdAt,
      expiresAt: updatedTransfer.expiresAt,
    },
  });
}

export const Route = createFileRoute("/api/transfers/$id/files/$fileId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});

export { handleDELETE as DELETE };
