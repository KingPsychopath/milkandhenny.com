import { createFileRoute } from "@tanstack/react-router";
import { buildAttachmentContentDisposition } from "@/features/downloads/presign";
import {
  getTransferMediaUrlTtlSeconds,
  isTransferMediaVariant,
  resolveTransferMediaTarget,
} from "@/features/transfers/media-access";
import { getTransfer } from "@/features/transfers/store.server";
import { isTransferStorageConfigured, presignGetUrl } from "@/lib/platform/r2.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { PRIVATE_MEDIA_CACHE_CONTROL } from "@/lib/shared/media-cache";

type RouteContext = {
  params: Promise<{ id: string; fileId: string; variant: string }>;
};

async function handleMedia(request: Request, context: RouteContext) {
  if (!isTransferStorageConfigured()) {
    return Response.json({ error: "Private transfer storage is not configured." }, { status: 503 });
  }

  const { id, fileId, variant } = await context.params;
  if (!isTransferMediaVariant(variant)) {
    return Response.json({ error: "Media not found." }, { status: 404 });
  }

  const transfer = await getTransfer(id);
  if (!transfer || new Date(transfer.expiresAt).getTime() <= Date.now()) {
    return Response.json({ error: "Transfer not found or expired." }, { status: 404 });
  }

  const target = resolveTransferMediaTarget(transfer, fileId, variant);
  if (!target) {
    return Response.json({ error: "Media not found." }, { status: 404 });
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const canRenderInline = /^(image|audio|video)\//.test(target.contentType);

  try {
    const url = await presignGetUrl(target.key, {
      expiresIn: getTransferMediaUrlTtlSeconds(variant),
      responseContentDisposition:
        download || !canRenderInline
          ? buildAttachmentContentDisposition(target.filename)
          : undefined,
      responseContentType: target.contentType,
      responseCacheControl: PRIVATE_MEDIA_CACHE_CONTROL,
      scope: "private",
    });

    return new Response(null, {
      status: 307,
      headers: {
        Location: url,
        "Cache-Control": PRIVATE_MEDIA_CACHE_CONTROL,
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "transfer.media",
      "Failed to prepare transfer media.",
      error,
      { transferId: id, fileId, variant },
    );
  }
}

export const Route = createFileRoute("/api/transfers/$id/media/$fileId/$variant")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleMedia(request, { params: Promise.resolve(params) }),
      HEAD: ({ request, params }) => handleMedia(request, { params: Promise.resolve(params) }),
    },
  },
});

export { handleMedia as GET };
