import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAuth } from "@/features/auth/auth.server";
import { runPitchesResult } from "@/features/things/pitches/pitches-runtime.server";
import { PitchesService } from "@/features/things/pitches/pitches-service.server";
import { isPitchDeckId } from "@/features/things/pitches/validation";
import { apiErrorFromRequest } from "@/lib/platform/api-error";

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
        const pitch = yield* pitches.readAdmin(deckId);
        if (!pitch) return null;
        return { pitch, assets: yield* pitches.adminAssets(deckId) };
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
    const body = (await request.json()) as { deckId?: unknown; archived?: unknown };
    if (
      typeof body.deckId !== "string" ||
      !isPitchDeckId(body.deckId) ||
      typeof body.archived !== "boolean"
    ) {
      return Response.json({ error: "Invalid request" }, { status: 400 });
    }
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.archive(body.deckId as string, body.archived as boolean);
      }),
    );
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    const pitch = result.value;
    return pitch
      ? Response.json({ pitch })
      : Response.json({ error: "Pitch not found" }, { status: 404 });
  } catch (error) {
    return apiErrorFromRequest(request, "admin.pitches", "Could not update pitch", error);
  }
}

export const Route = createFileRoute("/api/admin/pitches")({
  server: {
    handlers: {
      GET: ({ request }) => handleGET(request),
      PATCH: ({ request }) => handlePATCH(request),
    },
  },
});
