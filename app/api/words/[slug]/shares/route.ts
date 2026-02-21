import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { isWordsEnabled } from "@/features/words/reader";
import { createShareLink, listShareLinks } from "@/features/words/share";
import { getWordMeta } from "@/features/words/store";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
  }
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  try {
    const links = await listShareLinks(slug);
    return NextResponse.json({ links });
  } catch (error) {
    return apiErrorFromRequest(request, "words.share.list", "Failed to list share links", error, { slug });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!isWordsEnabled()) {
    return NextResponse.json({ error: "Words feature is disabled." }, { status: 404 });
  }
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  const noteMeta = await getWordMeta(slug);
  if (!noteMeta) {
    return NextResponse.json({ error: "Word not found" }, { status: 404 });
  }

  let body: { expiresInDays?: number; pinRequired?: boolean; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const { link, token } = await createShareLink({
      slug,
      expiresInDays: body.expiresInDays,
      pinRequired: body.pinRequired,
      pin: body.pin,
    });
    return NextResponse.json({ link, token }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create share link";
    if (/pin|required/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(request, "words.share.create", "Failed to create share link", error, { slug });
  }
}
