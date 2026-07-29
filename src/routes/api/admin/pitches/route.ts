import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { runPitchesResult } from "@/features/things/pitches/pitches-runtime.server";
import { PitchesService } from "@/features/things/pitches/pitches-service.server";
import {
  isPitchDeckId,
  parsePitchOwnerName,
  parsePitchTitle,
} from "@/features/things/pitches/validation";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const deckId = url.searchParams.get("deckId");
    if (!deckId) {
      const result = await runPitchesResult(
        Effect.gen(function* () {
          const pitches = yield* PitchesService;
          return yield* pitches.listAdmin();
        }),
      );
      return result.ok
        ? Response.json({ pitches: result.value })
        : Response.json({ error: result.error }, { status: result.status });
    }
    if (!isPitchDeckId(deckId)) return Response.json({ error: "Pitch not found" }, { status: 404 });
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.adminDetail(deckId);
      }),
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return result.value
      ? Response.json(result.value)
      : Response.json({ error: "Pitch not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.pitches", "Could not load pitches", error);
  }
}

async function handlePATCH(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.deckId !== "string" || !isPitchDeckId(body.deckId)) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const action = body.action;
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        if (action === "archive" && typeof body.archived === "boolean") {
          const pitch = yield* pitches.archive(body.deckId as string, body.archived);
          return pitch
            ? { ok: true as const, value: pitch }
            : { ok: false as const, status: 404, error: "Pitch not found" };
        }
        if (action === "update") {
          const title = typeof body.title === "string" ? parsePitchTitle(body.title) : null;
          const ownerName =
            typeof body.ownerName === "string" ? parsePitchOwnerName(body.ownerName) : null;
          const ownerEmail =
            typeof body.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : "";
          if (!title || !ownerName || !validEmail(ownerEmail)) {
            return { ok: false as const, status: 400, error: "Check the title, name and email" };
          }
          return yield* pitches.updateAdmin({
            deckId: body.deckId as string,
            title,
            ownerName,
            ownerEmail,
          });
        }
        if (action === "restore-backup" && typeof body.backupId === "string") {
          return yield* pitches.restoreAdmin(body.deckId as string, body.backupId);
        }
        if (action === "resend-access") {
          return yield* pitches.resendAdmin({
            deckId: body.deckId as string,
            origin: getBaseUrlForRequest(request),
          });
        }
        return { ok: false as const, status: 400, error: "Invalid request" };
      }),
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return result.value.ok
      ? Response.json({ value: result.value.value })
      : Response.json({ error: result.value.error }, { status: result.value.status });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.pitches", "Could not update pitch", error);
  }
}

async function handleDELETE(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      typeof body.deckId !== "string" ||
      !isPitchDeckId(body.deckId) ||
      typeof body.confirmation !== "string"
    ) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.deleteAdmin(body.deckId as string, body.confirmation as string);
      }),
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return result.value.ok
      ? Response.json(result.value.value)
      : Response.json({ error: result.value.error }, { status: result.value.status });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.pitches", "Could not delete pitch", error);
  }
}

export const Route = createFileRoute("/api/admin/pitches")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      PATCH: ({ request }) => handlePATCH(request),
      DELETE: ({ request }) => handleDELETE(request),
    },
  },
});
