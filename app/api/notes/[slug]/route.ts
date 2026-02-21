import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { isNotesEnabled } from "@/features/notes/reader";
import { noteAccessCookieName, verifyNoteAccessToken } from "@/features/notes/share";
import { deleteNote, getNote, updateNote } from "@/features/notes/store";
import type { NoteVisibility } from "@/features/notes/types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { isWordType, normaliseWordType } from "@/features/words/types";

type Params = {
  params: Promise<{ slug: string }>;
};

function isPublicVisibility(visibility: NoteVisibility): boolean {
  return visibility === "public" || visibility === "unlisted";
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
  }

  const { slug } = await params;
  try {
    const note = await getNote(slug);
    if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (isPublicVisibility(note.meta.visibility)) {
      return NextResponse.json(note);
    }

    const adminErr = await requireAuth(request, "admin");
    if (!adminErr) return NextResponse.json(note);

    const token = request.cookies.get(noteAccessCookieName(slug))?.value ?? "";
    if (token && (await verifyNoteAccessToken(slug, token))) {
      return NextResponse.json(note);
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(request, "notes.get", "Failed to load note", error, { slug });
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  let body: {
    title?: string;
    subtitle?: string | null;
    image?: string | null;
    type?: string;
    visibility?: NoteVisibility;
    markdown?: string;
    tags?: string[];
    featured?: boolean;
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

  try {
    const updated = await updateNote(slug, {
      ...body,
      type: body.type ? normaliseWordType(body.type) : undefined,
    });
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update note";
    if (/invalid|required/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return apiErrorFromRequest(request, "notes.update", "Failed to update note", error, { slug });
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!isNotesEnabled()) {
    return NextResponse.json({ error: "Notes feature is disabled." }, { status: 404 });
  }

  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  const { slug } = await params;
  try {
    const deleted = await deleteNote(slug);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorFromRequest(request, "notes.delete", "Failed to delete note", error, { slug });
  }
}
