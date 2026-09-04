import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { getTransfer } from "@/features/transfers/store.server";
import { toPublicTransfer } from "@/features/transfers/public";
import { TransferOperationsService } from "@/features/transfers/transfer-operations-service.server";
import { runMediaEffect } from "@/features/system/media-worker-runtime.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { requestOwnsTransfer } from "@/features/transfers/upload-access.server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/transfers/[id]
 *
 * Returns transfer metadata (without delete token) for the share page.
 * Keeps the delete token server-side — never exposed to the public.
 */
async function handleGET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const transfer = await getTransfer(id);
  if (!transfer) {
    return Response.json({ error: "Transfer not found or expired" }, { status: 404 });
  }

  const remainingSeconds = Math.floor((new Date(transfer.expiresAt).getTime() - Date.now()) / 1000);

  if (remainingSeconds <= 0) {
    return Response.json({ error: "Transfer has expired" }, { status: 410 });
  }

  // Return public data — no deleteToken
  return Response.json({ ...toPublicTransfer(transfer), remainingSeconds });
}

/**
 * DELETE /api/transfers/[id]
 *
 * Takes down a transfer. Requires its delete token or signed-in owner identity.
 * Deletes both the R2 objects and the Redis metadata.
 */
async function handleDELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;

  let token: string | null = null;
  try {
    const body = (await request.json()) as { token?: unknown };
    token = typeof body.token === "string" ? body.token : null;
  } catch {
    // Signed-in account owners do not need the private token.
  }

  try {
    if (token) {
      const result = await runMediaEffect(
        Effect.gen(function* () {
          const transfers = yield* TransferOperationsService;
          return yield* transfers.takedown({ id, token });
        }),
        request.signal,
      );
      if (result.authorised) {
        return Response.json({
          success: true,
          deletedFiles: result.deletedFiles,
          dataDeleted: result.dataDeleted,
          message: "Transfer has been taken down.",
        });
      }
    }
    if (!(await requestOwnsTransfer(request, id))) {
      return Response.json(
        { error: "Invalid delete token or transfer not found" },
        { status: 403 },
      );
    }
    const result = await runMediaEffect(
      Effect.gen(function* () {
        const transfers = yield* TransferOperationsService;
        return yield* transfers.adminDelete(id);
      }),
      request.signal,
    );
    return Response.json({
      success: true,
      deletedFiles: result.deletedFiles,
      dataDeleted: result.dataDeleted,
      message: "Transfer has been taken down.",
    });
  } catch (error) {
    return apiErrorFromRequest(request, "transfers.takedown", "Transfer takedown failed", error, {
      id,
    });
  }
}

export const Route = createFileRoute("/api/transfers/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, { params: Promise.resolve(params) }),
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});
