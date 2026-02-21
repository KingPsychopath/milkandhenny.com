import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAuth, requireAuthWithPayload } from "@/features/auth/server";
import { isWordsEnabled } from "@/features/words/reader";
import { createWord, listWords } from "@/features/words/store";
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

async function revalidateWordSurfaces(slug: string): Promise<void> {
  await Promise.all([
    revalidatePath("/", "page"),
    revalidatePath("/words", "page"),
    revalidatePath(`/words/${slug}`, "page"),
    revalidatePath(`/vault/${slug}`, "page"),
    revalidatePath("/feed.xml"),
    revalidatePath("/sitemap.xml"),
  ]);
}

export async function GET(request: NextRequest) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const auth = await requireAuthWithPayload(request, "admin");
  const isAdmin = !auth.error && !!auth.payload;

  const visibility = parseVisibility(request.nextUrl.searchParams.get("visibility"));
  const typeParam = request.nextUrl.searchParams.get("type");
  const type = parseWordType(typeParam);
  const tag = request.nextUrl.searchParams.get("tag") ?? undefined;
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const cursor = request.nextUrl.searchParams.get("cursor") ?? undefined;
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

  if (!isAdmin && visibility && visibility !== "public") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (typeParam && !type) {
    return NextResponse.json({ error: "Invalid type value" }, { status: 400 });
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
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorFromRequest(request, "words.list", "Failed to list words", error);
  }
}

export async function POST(request: NextRequest) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = (body.slug ?? "").trim().toLowerCase();
  const title = (body.title ?? "").trim();
  const markdown = typeof body.markdown === "string" ? body.markdown : "";
  if (body.type && body.type !== "post" && !isWordType(body.type)) {
    return NextResponse.json({ error: "Invalid type value" }, { status: 400 });
  }

  if (!slug || !title || !markdown.trim()) {
    return NextResponse.json(
      { error: "slug, title, and markdown are required." },
      { status: 400 }
    );
  }
  if (body.image !== undefined && typeof body.image !== "string") {
    return NextResponse.json({ error: "image must be a string" }, { status: 400 });
  }
  if (body.featured !== undefined && typeof body.featured !== "boolean") {
    return NextResponse.json({ error: "featured must be a boolean" }, { status: 400 });
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
    await revalidateWordSurfaces(slug);
    return NextResponse.json(word, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create word";
    const status = /exists|invalid|required/i.test(message) ? 400 : 500;
    if (status === 400) return NextResponse.json({ error: message }, { status });
    return apiErrorFromRequest(request, "words.create", "Failed to create word", error);
  }
}
