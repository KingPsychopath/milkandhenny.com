import { createFileRoute } from "@tanstack/react-router";
import { getCookie } from "@/lib/http/cookies";
import { requireAuth } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { wordAccessCookieName, verifyWordAccessToken } from "@/features/words/share.server";
import { deleteWord, getWord, updateWord } from "@/features/words/store.server";
import type { WordVisibility } from "@/features/words/content-types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isWordType, normaliseWordType } from "@/features/words/types";

type Params = {
  params: Promise<{ slug: string }>;
};

function isPublicVisibility(visibility: WordVisibility): boolean {
  return visibility === "public" || visibility === "unlisted";
}

async function handleGET(request: Request, { params }: Params) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const { slug } = await params;
  try {
    const note = await getWord(slug);
    if (!note) return Response.json({ error: "Not found" }, { status: 404 });

    if (isPublicVisibility(note.meta.visibility)) {
      return Response.json(note);
    }

    const adminErr = await requireAuth(request, "admin");
    if (!adminErr) return Response.json(note);

    const token = getCookie(request, wordAccessCookieName(slug));
    if (token && (await verifyWordAccessToken(slug, token))) {
      return Response.json(note);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(request, "words.get", "Failed to load word", error, { slug });
  }
}

async function handlePUT(request: Request, { params }: Params) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  let body: {
    title?: string;
    subtitle?: string | null;
    image?: string | null;
    type?: string;
    visibility?: WordVisibility;
    markdown?: string;
    tags?: string[];
    featured?: boolean;
    expectedUpdatedAt?: string;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    body.visibility &&
    body.visibility !== "public" &&
    body.visibility !== "unlisted" &&
    body.visibility !== "private"
  ) {
    return Response.json({ error: "Invalid visibility value" }, { status: 400 });
  }
  if (body.type && body.type !== "post" && !isWordType(body.type)) {
    return Response.json({ error: "Invalid type value" }, { status: 400 });
  }
  if (body.image !== undefined && body.image !== null && typeof body.image !== "string") {
    return Response.json({ error: "image must be a string or null" }, { status: 400 });
  }
  if (body.featured !== undefined && typeof body.featured !== "boolean") {
    return Response.json({ error: "featured must be a boolean" }, { status: 400 });
  }
  if (
    body.expectedUpdatedAt !== undefined &&
    body.expectedUpdatedAt !== null &&
    typeof body.expectedUpdatedAt !== "string"
  ) {
    return Response.json({ error: "expectedUpdatedAt must be a string" }, { status: 400 });
  }

  try {
    const expectedUpdatedAt = body.expectedUpdatedAt?.trim() || undefined;
    if (expectedUpdatedAt) {
      const current = await getWord(slug);
      if (!current) return Response.json({ error: "Not found" }, { status: 404 });
      if (current.meta.updatedAt !== expectedUpdatedAt) {
        return Response.json(
          {
            error:
              "This word was updated elsewhere. Reload to review the latest version before saving.",
            conflict: true,
            currentUpdatedAt: current.meta.updatedAt,
          },
          { status: 409 },
        );
      }
    }

    const updated = await updateWord(slug, {
      ...body,
      type: body.type ? normaliseWordType(body.type) : undefined,
    });
    if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update word";
    if (/invalid|required/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(request, "words.update", "Failed to update word", error, { slug });
  }
}

async function handleDELETE(request: Request, { params }: Params) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  try {
    const deleted = await deleteWord(slug);
    if (!deleted) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(request, "words.delete", "Failed to delete word", error, { slug });
  }
}

export const Route = createFileRoute("/api/words/$slug")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGET(request, { params: Promise.resolve(params) }),
      PUT: ({ request, params }) => handlePUT(request, { params: Promise.resolve(params) }),
      DELETE: ({ request, params }) => handleDELETE(request, { params: Promise.resolve(params) }),
    },
  },
});
