import { createFileRoute } from "@tanstack/react-router";
import { requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { createShareLink, listShareLinks } from "@/features/words/share.server";
import { getWordMeta } from "@/features/words/store.server";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type Params = { params: Promise<{ slug: string }> };

async function handleGET(request: Request, { params }: Params) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  try {
    const links = await listShareLinks(slug);
    return Response.json({ links });
  } catch (error) {
    return apiErrorFromRequest(request, "words.share.list", "Failed to list share links", error, {
      slug,
    });
  }
}

async function handlePOST(request: Request, { params }: Params) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  const noteMeta = await getWordMeta(slug);
  if (!noteMeta) {
    return Response.json({ error: "Word not found" }, { status: 404 });
  }

  let body: { expiresInDays?: number; pinRequired?: boolean; pin?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { link, token } = await createShareLink({
      slug,
      expiresInDays: body.expiresInDays,
      pinRequired: body.pinRequired,
      pin: body.pin,
    });
    return Response.json({ link, token }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create share link";
    if (/pin|required/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(
      request,
      "words.share.create",
      "Failed to create share link",
      error,
      { slug },
    );
  }
}

export const Route = createFileRoute("/api/words/$slug/shares")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, { params: Promise.resolve(params) }),
      POST: ({ request, params }) => handlePOST(request, { params: Promise.resolve(params) }),
    },
  },
});
