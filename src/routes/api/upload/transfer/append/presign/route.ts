import { createFileRoute } from "@tanstack/react-router";
import { requireAuthWithPayload } from "@/features/auth/auth.server";
import { appendPresign } from "@/features/transfers/append.server";
import {
  MAX_TRANSFER_FILE_BYTES,
  MAX_TRANSFER_TOTAL_BYTES,
  validateDeleteToken,
} from "@/features/transfers/store.server";
import type { TransferUploadFileInput } from "@/features/transfers/upload-types";

export const runtime = "nodejs";

/** Presign extra files for an admin or the holder of a transfer's private owner token. */
async function handlePOST(request: Request) {
  const { error: authErr, payload } = await requireAuthWithPayload(request, "upload");
  if (authErr) return authErr;

  let body: { transferId?: string; deleteToken?: string; files?: TransferUploadFileInput[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const transferId = body.transferId?.trim();
  if (!transferId) return Response.json({ error: "Missing transferId" }, { status: 400 });
  const isAdmin = payload?.role === "admin";
  if (!isAdmin && !(await validateDeleteToken(transferId, body.deleteToken ?? ""))) {
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
