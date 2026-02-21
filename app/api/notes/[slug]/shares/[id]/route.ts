import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { isNotesEnabled } from "@/features/notes/reader";
import { revokeShareLink, updateShareLink } from "@/features/notes/share";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

type Params = { params: Promise<{ slug: string; id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const updated = await updateShareLink(slug, id, body);
    if (!updated) return NextResponse.json({ error: "Share link not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update share link";
    if (/pin|expired|revoked/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(request, "notes.share.update", "Failed to update share link", error, { slug, id });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug, id } = await params;
  try {
    const ok = await revokeShareLink(slug, id);
    if (!ok) return NextResponse.json({ error: "Share link not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(request, "notes.share.revoke", "Failed to revoke share link", error, { slug, id });
  }
}
