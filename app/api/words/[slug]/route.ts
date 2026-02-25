import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/features/auth/server";
import { isWordsEnabled } from "@/features/words/reader";
import { wordAccessCookieName, verifyWordAccessToken } from "@/features/words/share";
import { deleteWord, getWord, updateWord } from "@/features/words/store";
import type { WordVisibility } from "@/features/words/content-types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isWordType, normaliseWordType } from "@/features/words/types";

type Params = {
  params: Promise<{ slug: string }>;
};

function isPublicVisibility(visibility: WordVisibility): boolean {
  return visibility === "public" || visibility === "unlisted";
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

export async function GET(request: NextRequest, { params }: Params) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const { slug } = await params;
  try {
    const note = await getWord(slug);
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (isPublicVisibility(note.meta.visibility)) {
      return NextResponse.json(note);
    }

    const adminErr = await requireAuth(request, "admin");
    if (!adminErr) return NextResponse.json(note);

    const token = request.cookies.get(wordAccessCookieName(slug))?.value ?? "";
    if (token && (await verifyWordAccessToken(slug, token))) {
      return NextResponse.json(note);
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(request, "words.get", "Failed to load word", error, { slug });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    body.visibility &&
    body.visibility !== "public" &&
    body.visibility !== "unlisted" &&
    body.visibility !== "private"
  ) {
    return NextResponse.json({ error: "Invalid visibility value" }, { status: 400 });
  }
  if (body.type && body.type !== "post" && !isWordType(body.type)) {
    return NextResponse.json({ error: "Invalid type value" }, { status: 400 });
  }
  if (body.image !== undefined && body.image !== null && typeof body.image !== "string") {
    return NextResponse.json({ error: "image must be a string or null" }, { status: 400 });
  }
  if (body.featured !== undefined && typeof body.featured !== "boolean") {
    return NextResponse.json({ error: "featured must be a boolean" }, { status: 400 });
  }
  if (
    body.expectedUpdatedAt !== undefined &&
    body.expectedUpdatedAt !== null &&
    typeof body.expectedUpdatedAt !== "string"
  ) {
    return NextResponse.json({ error: "expectedUpdatedAt must be a string" }, { status: 400 });
  }

  try {
    const expectedUpdatedAt = body.expectedUpdatedAt?.trim() || undefined;
    if (expectedUpdatedAt) {
      const current = await getWord(slug);
      if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (current.meta.updatedAt !== expectedUpdatedAt) {
        return NextResponse.json(
          {
            error: "This word was updated elsewhere. Reload to review the latest version before saving.",
            conflict: true,
            currentUpdatedAt: current.meta.updatedAt,
          },
          { status: 409 }
        );
      }
    }

    const updated = await updateWord(slug, {
      ...body,
      type: body.type ? normaliseWordType(body.type) : undefined,
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await revalidateWordSurfaces(slug);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update word";
    if (/invalid|required/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(request, "words.update", "Failed to update word", error, { slug });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  try {
    const deleted = await deleteWord(slug);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await revalidateWordSurfaces(slug);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(request, "words.delete", "Failed to delete word", error, { slug });
  }
}
