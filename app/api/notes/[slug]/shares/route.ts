import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { isNotesEnabled } from "@/features/notes/reader";
import { createShareLink, listShareLinks } from "@/features/notes/share";
import { getNoteMeta } from "@/features/notes/store";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
  }
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  try {
    const links = await listShareLinks(slug);
    return NextResponse.json({ links });
  } catch (error) {
    return apiErrorFromRequest(request, "notes.share.list", "Failed to list share links", error, { slug });
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
  }
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  const noteMeta = await getNoteMeta(slug);
  if (!noteMeta) {
    return NextResponse.json({ error: "Note not found" }, { status: 404 });
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
    return apiErrorFromRequest(request, "notes.share.create", "Failed to create share link", error, { slug });
  }
}
