import { buildEventPrintPack, renderDiscoveryPrintPdf } from "../print.server";
import { PRINT_PACK_KINDS, printLayout } from "../print";
import { getScoring, listScoringActivities } from "../scoring.server";
import {
  createScoreMediaLink,
  deleteScoreMediaLink,
  listLeaderboardParticipants,
  listPools,
  listScoreAuditEvents,
  listScoreMediaLinks,
  listStaffAssignments,
  updateScoreMediaConsent,
} from "../store.server";
import { listDiscoveries } from "../discoveries.server";
import { stringValue, stringsValue, type AdminScoringActionHandlers } from "./shared";

export const mediaExportActions: AdminScoringActionHandlers = {
  "print-pack": printPack,
  "print-pdf": printPack,

  "link-media": async ({ eventSlug, actorId, body }) => {
    const storageRef = stringValue(body.storageRef);
    if (!storageRef)
      return Response.json({ error: "A stored media reference is required" }, { status: 400 });
    const result = await createScoreMediaLink({
      eventSlug,
      activityId: stringValue(body.activityId),
      transactionId: stringValue(body.transactionId),
      participantId: stringValue(body.participantId),
      staffActorId: actorId,
      storageRef,
      visibility:
        body.visibility === "event-album" || body.visibility === "discard"
          ? body.visibility
          : "admin-evidence",
      consentState:
        body.consentState === "requested" ||
        body.consentState === "obtained" ||
        body.consentState === "declined"
          ? body.consentState
          : "not-requested",
      expiresAt: stringValue(body.expiresAt),
    });
    return result.ok
      ? Response.json({ media: result.value }, { status: 201 })
      : Response.json({ error: result.error }, { status: result.status });
  },

  "media-consent": async ({ body }) => {
    const mediaId = stringValue(body.mediaId);
    const consentState = body.consentState;
    if (
      !mediaId ||
      !["not-requested", "requested", "obtained", "declined"].includes(String(consentState))
    )
      return Response.json({ error: "Media and consent state are required" }, { status: 400 });
    return Response.json({
      updated: await updateScoreMediaConsent(
        mediaId,
        consentState as "not-requested" | "requested" | "obtained" | "declined",
      ),
    });
  },

  "delete-media": async ({ body }) => {
    const mediaId = stringValue(body.mediaId);
    if (!mediaId) return Response.json({ error: "Media is required" }, { status: 400 });
    return Response.json({ deleted: await deleteScoreMediaLink(mediaId) });
  },

  export: async ({ eventSlug }) => {
    const [settings, activities, participants, pools, discoveries, staff, audit, media] =
      await Promise.all([
        getScoring(eventSlug),
        listScoringActivities(eventSlug),
        listLeaderboardParticipants(eventSlug),
        listPools(eventSlug),
        listDiscoveries(eventSlug),
        listStaffAssignments(eventSlug),
        listScoreAuditEvents({ eventSlug, limit: 500 }),
        listScoreMediaLinks(eventSlug),
      ]);
    return new Response(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          eventSlug,
          settings,
          activities,
          participants,
          pools,
          discoveries,
          staff,
          audit,
          media,
        },
        null,
        2,
      ),
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="${eventSlug}-scoring-export.json"`,
          "Content-Type": "application/json",
        },
      },
    );
  },
};

async function printPack({ eventSlug, body }: Parameters<(typeof mediaExportActions)[string]>[0]) {
  const layout = stringValue(body.layout);
  if (!layout || !printLayout(layout))
    return Response.json({ error: "A valid print layout is required" }, { status: 400 });
  const kind =
    typeof body.kind === "string" && PRINT_PACK_KINDS.includes(body.kind as never)
      ? (body.kind as (typeof PRINT_PACK_KINDS)[number])
      : "hunt";
  const result = await buildEventPrintPack({
    eventSlug,
    kind,
    layout,
    paper:
      body.paper === "letter" || body.paper === "a5" || body.paper === "card" ? body.paper : "a4",
    includePoints: body.includePoints !== false,
    includePlacementNotes: body.includePlacementNotes === true,
    includeCutGuides: body.includeCutGuides !== false,
    includePageNumbers: body.includePageNumbers !== false,
    discoveryIds: Array.isArray(body.discoveryIds) ? stringsValue(body.discoveryIds) : undefined,
  });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
  if (stringValue(body.action) === "print-pdf") {
    const pdf = await renderDiscoveryPrintPdf(result);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${eventSlug}-${kind}-pack.pdf"`,
        "Content-Type": "application/pdf",
      },
    });
  }
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
