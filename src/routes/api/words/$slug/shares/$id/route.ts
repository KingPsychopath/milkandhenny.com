import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { revokeShareLink, updateShareLink } from "@/features/words/share.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type Params = { params: Promise<{ slug: string; id: string }> };

async function handlePATCH(request: Request, { params }: Params) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug, id } = await params;
  let body: {
    pinRequired?: boolean;
    pin?: string | null;
    expiresInDays?: number;
    rotateToken?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const updated = await updateShareLink(slug, id, body);
    if (!updated) return Response.json({ error: "Share link not found" }, { status: 404 });
    return Response.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update share link";
    if (/pin|expired|revoked/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(
      request,
      "words.share.update",
      "Failed to update share link",
      error,
      { slug, id },
    );
  }
}

async function handleDELETE(request: Request, { params }: Params) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug, id } = await params;
  try {
    const ok = await revokeShareLink(slug, id);
    if (!ok) return Response.json({ error: "Share link not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "words.share.revoke",
      "Failed to revoke share link",
      error,
      { slug, id },
    );
  }
}

export const Route = createFileRoute("/api/words/$slug/shares/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handlePATCH(request, { params: Promise.resolve(params) }),
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});
