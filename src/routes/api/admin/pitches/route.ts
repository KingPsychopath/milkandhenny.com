import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { requireAdminStepUp, requireAuth } from "@/features/auth/auth.server";
import { runPitchesResult } from "@/features/things/pitches/pitches-runtime.server";
import { PitchesService } from "@/features/things/pitches/pitches-service.server";
import {
  getPitchOperationalStatus,
  setPitchAdminMode,
} from "@/features/things/pitches/operational.server";
import { isPitchOperationalMode } from "@/features/things/pitches/types";
import {
  isPitchDeckId,
  parsePitchOwnerName,
  parsePitchTitle,
} from "@/features/things/pitches/validation";
import { PITCH_REMINDER_TEMPLATES } from "@/features/things/pitches/types";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { isValidEmail } from "@/lib/shared/email-address";

async function handleGET(request: Request) {
  const authError = await requireAuth(request, "admin");
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const deckId = url.searchParams.get("deckId");
    if (url.searchParams.get("view") === "reminders") {
      const result = await runPitchesResult(
        Effect.gen(function* () {
          const pitches = yield* PitchesService;
          return yield* pitches.reminderAdmin();
        }),
      );
      return result.ok
        ? Response.json({ reminders: result.value })
        : Response.json({ error: result.error }, { status: result.status });
    }
    if (!deckId) {
      const [result, operationalStatus] = await Promise.all([
        runPitchesResult(
          Effect.gen(function* () {
            const pitches = yield* PitchesService;
            return yield* pitches.listAdmin();
          }),
        ),
        getPitchOperationalStatus({ includeConfiguredMode: true }),
      ]);
      return result.ok
        ? Response.json({ pitches: result.value, operationalStatus })
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
    if (body.action === "set-operational-mode") {
      if (!isPitchOperationalMode(body.mode)) {
        return Response.json({ error: "Choose enabled, read-only, or off" }, { status: 400 });
      }
      return Response.json({ operationalStatus: await setPitchAdminMode(body.mode) });
    }
    if (body.action === "update-reminder-settings") {
      const enabled = body.enabled;
      const inactivityDays = body.inactivityDays;
      const gapDays = body.gapDays;
      const maxAutomatic = body.maxAutomatic;
      if (
        typeof enabled !== "boolean" ||
        typeof inactivityDays !== "number" ||
        typeof gapDays !== "number" ||
        typeof maxAutomatic !== "number"
      ) {
        return Response.json({ error: "Choose valid reminder settings" }, { status: 400 });
      }
      const result = await runPitchesResult(
        Effect.gen(function* () {
          const pitches = yield* PitchesService;
          return yield* pitches.updateReminderSettings({
            enabled,
            inactivityDays,
            gapDays,
            maxAutomatic,
          });
        }),
      );
      return result.ok
        ? Response.json({ reminders: result.value })
        : Response.json({ error: result.error }, { status: result.status });
    }
    if (body.action === "send-reminder-wave") {
      const deckIds = Array.isArray(body.deckIds)
        ? body.deckIds.filter((value): value is string => typeof value === "string")
        : [];
      if (
        deckIds.length === 0 ||
        typeof body.template !== "string" ||
        !PITCH_REMINDER_TEMPLATES.includes(
          body.template as (typeof PITCH_REMINDER_TEMPLATES)[number],
        )
      ) {
        return Response.json({ error: "Choose at least one pitch and a message" }, { status: 400 });
      }
      const result = await runPitchesResult(
        Effect.gen(function* () {
          const pitches = yield* PitchesService;
          return yield* pitches.sendReminderWave({
            deckIds,
            template: body.template as (typeof PITCH_REMINDER_TEMPLATES)[number],
            origin: getBaseUrlForRequest(request),
            actor: "admin",
          });
        }),
      );
      return result.ok
        ? Response.json({ result: result.value })
        : Response.json({ error: result.error }, { status: result.status });
    }
    if (typeof body.deckId !== "string" || !isPitchDeckId(body.deckId)) {
      return Response.json({ error: "Choose a pitch and try again" }, { status: 400 });
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
        if (
          action === "set-lifecycle" &&
          (body.lifecycle === "active" ||
            body.lifecycle === "archived" ||
            body.lifecycle === "trashed")
        ) {
          const pitch = yield* pitches.setLifecycleAdmin(body.deckId as string, body.lifecycle);
          return pitch
            ? { ok: true as const, value: pitch }
            : { ok: false as const, status: 404, error: "Pitch not found" };
        }
        if (
          action === "set-publication" &&
          (body.publication === "draft" || body.publication === "published")
        ) {
          return yield* pitches.setPublicationAdmin(body.deckId as string, body.publication);
        }
        if (action === "update") {
          const title = typeof body.title === "string" ? parsePitchTitle(body.title) : null;
          const ownerName =
            typeof body.ownerName === "string" ? parsePitchOwnerName(body.ownerName) : null;
          const ownerEmail =
            typeof body.ownerEmail === "string" ? body.ownerEmail.trim().toLowerCase() : "";
          if (!title || !ownerName || !isValidEmail(ownerEmail)) {
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
        if (action === "restore-trash") {
          return yield* pitches.restoreTrashAdmin(body.deckId as string);
        }
        if (action === "resend-access") {
          return yield* pitches.resendAdmin({
            deckId: body.deckId as string,
            origin: getBaseUrlForRequest(request),
          });
        }
        return { ok: false as const, status: 400, error: "That pitch action is not available" };
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
  const stepUpError = await requireAdminStepUp(request);
  if (stepUpError) return stepUpError;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      typeof body.deckId !== "string" ||
      !isPitchDeckId(body.deckId) ||
      typeof body.confirmation !== "string"
    ) {
      return Response.json(
        { error: "Choose a pitch and type its exact title to move it to Trash" },
        { status: 400 },
      );
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
