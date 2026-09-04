import { createFileRoute } from "@tanstack/react-router";
import { appendPresign } from "@/features/transfers/append.server";
import {
  getTransfer,
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
  validateDeleteToken,
} from "@/features/transfers/store.server";
import { requireTransferUploadAccess } from "@/features/transfers/upload-access.server";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";

export const runtime = "nodejs";

/** Presign extra files for an admin, private-token owner, or signed-in account owner. */
async function handlePOST(request: Request) {
  let body: { transferId?: string; deleteToken?: string; files?: TransferUploadFileInput[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transferId = body.transferId?.trim();
  if (!transferId) return Response.json({ error: "Missing transferId" }, { status: 400 });
  const [ownerAccess, auth] = await Promise.all([
    validateDeleteToken(transferId, body.deleteToken ?? ""),
    requireTransferUploadAccess(request),
  ]);
  if (auth.error && !ownerAccess) return auth.error;
  const isAdmin = auth.access?.isAdmin === true;
  const transfer = auth.access?.ownerPersonId ? await getTransfer(transferId) : null;
  const accountOwner = Boolean(
    auth.access?.ownerPersonId && transfer?.ownerPersonId === auth.access.ownerPersonId,
  );
  if (!isAdmin && !ownerAccess && !accountOwner) {
    return Response.json({ error: "Private owner access is required" }, { status: 403 });
  }

  return appendPresign(
    request,
    transferId,
    body.files,
    isAdmin
      ? {}
      : { maxFileBytes: MAX_TRANSFER_FILE_BYTES, maxTotalBytes: MAX_TRANSFER_TOTAL_BYTES },
  );
}

export const Route = createFileRoute("/api/upload/transfer/append/presign")({
  server: {
    handlers: {
      POST: ({ request }) => handlePOST(request),
    },
  },
});

export { handlePOST as POST };
