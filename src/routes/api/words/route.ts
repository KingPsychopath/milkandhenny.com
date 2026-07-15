import { createFileRoute } from "@tanstack/react-router";
import { requireAuth, requireAuthWithPayload } from "@/features/auth/auth.server";
import { isWordsEnabled } from "@/features/words/reader.server";
import { createWord, listWords } from "@/features/words/store.server";
import type { WordVisibility } from "@/features/words/content-types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import type { WordType } from "@/features/words/types";
import { isWordType, normaliseWordType } from "@/features/words/types";

function parseVisibility(value: string | null): WordVisibility | undefined {
  if (value === "public" || value === "unlisted" || value === "private") {
    return value;
  }
  return undefined;
}

function parseWordType(value: string | null): WordType | undefined {
  if (!value) return undefined;
  if (value === "post") return "blog";
  return isWordType(value) ? value : undefined;
}

async function handleGET(request: Request) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const auth = await requireAuthWithPayload(request, "admin");
  const isAdmin = !auth.error && !!auth.payload;

  const visibility = parseVisibility(new URL(request.url).searchParams.get("visibility"));
  const typeParam = new URL(request.url).searchParams.get("type");
  const type = parseWordType(typeParam);
  const tag = new URL(request.url).searchParams.get("tag") ?? undefined;
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  const limitRaw = Number(new URL(request.url).searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

  if (!isAdmin && visibility && visibility !== "public") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (typeParam && !type) {
    return Response.json({ error: "Invalid type value" }, { status: 400 });
  }

  try {
    const result = await listWords({
      visibility,
      type,
      tag,
      q,
      cursor,
      limit,
      includeNonPublic: isAdmin,
    });
    return Response.json(result);
  } catch (error) {
    return apiErrorFromRequest(request, "words.list", "Failed to list words", error);
  }
}

async function handlePOST(request: Request) {
  if (!isWordsEnabled()) {
    return Response.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  let body: {
    slug?: string;
    title?: string;
    subtitle?: string;
    image?: string;
    type?: string;
    visibility?: WordVisibility;
    markdown?: string;
    tags?: string[];
    featured?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  const title = (body.title ?? "").trim();
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (body.type && body.type !== "post" && !isWordType(body.type)) {
    return Response.json({ error: "Invalid type value" }, { status: 400 });
  }

  if (!slug || !title || !markdown.trim()) {
    return Response.json({ error: "slug, title, and markdown are required." }, { status: 400 });
  }
  if (body.image !== undefined && typeof body.image !== "string") {
    return Response.json({ error: "image must be a string" }, { status: 400 });
  }
  if (body.featured !== undefined && typeof body.featured !== "boolean") {
    return Response.json({ error: "featured must be a boolean" }, { status: 400 });
  }

  try {
    const word = await createWord({
      slug,
      title,
      subtitle: body.subtitle,
      image: body.image,
      type: body.type ? normaliseWordType(body.type) : undefined,
      visibility: body.visibility ?? "private",
      markdown,
      tags: body.tags,
      featured: typeof body.featured === "boolean" ? body.featured : undefined,
    });
    return Response.json(word, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create word";
    const status = /exists|invalid|required/i.test(message) ? 400 : 500;
    if (status === 400) return Response.json({ error: message }, { status });
    return apiErrorFromRequest(request, "words.create", "Failed to create word", error);
  }
}

export const Route = createFileRoute("/api/words")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      POST: ({ request }) => handlePOST(request),
    },
  },
});
