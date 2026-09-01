import { getEventDrop } from "@/features/events/drop.server";
import { listCheckpoints } from "@/features/tickets/checkpoints.server";
import { listDiscoveryClues, listDiscoveries } from "../discoveries.server";
import { listHeldOfficialGameResults } from "../games.server";
import { listEventGameRegister } from "../event-games.server";
import { getScoringOperationsSnapshot } from "../operations.server";
import {
  adminParticipantScore,
  getScoring,
  listPersonalActivityTemplates,
  listScoringActivities,
} from "../scoring.server";
import {
  listHeldScoreTransactions,
  listCheckedInTeamParticipants,
  listParticipantMerges,
  listPools,
  listScoreAnomalyFlags,
  listScoreAuditEvents,
  listScoreMediaLinks,
  listStaffAssignments,
  listStaffRoles,
  listStaffDevices,
  listTeams,
  searchEventParticipants,
} from "../store.server";

export async function readAdminScoring(
  request: Request,
  eventSlug: string,
  actorId: string,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const search = params.get("participant");
  if (search) {
    return Response.json({ participants: await searchEventParticipants(eventSlug, search) });
  }
  const scoreParticipant = params.get("scoreParticipant");
  if (scoreParticipant) {
    const result = await adminParticipantScore({ eventSlug, participantId: scoreParticipant });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ participantScore: result.value });
  }

  const [
    settings,
    activities,
    pools,
    discoveries,
    teams,
    teamRoster,
    held,
    heldOfficialResults,
    staff,
    staffRoles,
    checkpoints,
    media,
    drop,
    audit,
    anomalies,
    merges,
    personalTemplates,
    operations,
    eventGames,
  ] = await Promise.all([
    getScoring(eventSlug),
    listScoringActivities(eventSlug),
    listPools(eventSlug),
    listDiscoveries(eventSlug),
    listTeams(eventSlug),
    listCheckedInTeamParticipants(eventSlug),
    listHeldScoreTransactions(eventSlug),
    listHeldOfficialGameResults(eventSlug),
    listStaffAssignments(eventSlug),
    listStaffRoles(eventSlug),
    listCheckpoints(eventSlug),
    listScoreMediaLinks(eventSlug),
    getEventDrop(eventSlug),
    listScoreAuditEvents({
      eventSlug,
      participantId: params.get("auditParticipant") ?? undefined,
      actorId: params.get("auditActor") ?? undefined,
      activityId: params.get("auditActivity") ?? undefined,
      sourceType: (params.get("auditSource") ?? undefined) as Parameters<
        typeof listScoreAuditEvents
      >[0]["sourceType"],
      status: (params.get("auditStatus") ?? undefined) as Parameters<
        typeof listScoreAuditEvents
      >[0]["status"],
      from: params.get("auditFrom") ?? undefined,
      to: params.get("auditTo") ?? undefined,
      limit: 100,
    }),
    listScoreAnomalyFlags(eventSlug),
    listParticipantMerges(eventSlug),
    listPersonalActivityTemplates(actorId),
    getScoringOperationsSnapshot(eventSlug),
    listEventGameRegister(eventSlug),
  ]);

  return Response.json({
    settings,
    activities,
    pools,
    discoveries: await Promise.all(
      discoveries.map(async (discovery) => ({
        ...discovery,
        clues: discovery.method === "collected-clues" ? await listDiscoveryClues(discovery.id) : [],
      })),
    ),
    teams,
    teamRoster,
    held,
    heldOfficialResults,
    staff: await Promise.all(
      staff.map(async (assignment) => ({
        ...assignment,
        devices: await listStaffDevices(assignment.id),
      })),
    ),
    staffRoles,
    checkpoints,
    media,
    mediaDrop: drop
      ? {
          uploadPath: drop.live ? `/drop/${drop.token}` : undefined,
          albumPath: `/t/${drop.transferId}`,
          expiresAt: drop.expiresAt,
        }
      : null,
    audit,
    anomalies,
    merges,
    personalTemplates,
    operations,
    eventGames,
  });
}
