import { isCapabilityEffective } from "@/features/attendee-operations/capabilities.server";
import { getEventDrop, getEventDropSchedule } from "@/features/events/drop.server";
import { getEvent } from "@/features/events/store.server";
import {
  resolveStaffAccess,
  staffAssignmentForPermission,
} from "@/features/event-scoring/staff.server";
import { listCheckedInTeamParticipants, listTeams } from "@/features/event-scoring/store.server";
import { listCheckpoints } from "@/features/tickets/checkpoints.server";
import { listTicketsForEvent } from "@/features/tickets/store.server";
import { ticketPublicId } from "@/features/tickets/types";
import {
  listGuestRequests,
  listGuestRequestsForToken,
} from "@/features/tickets/guest-requests.server";
import { sendEventTeamEmails } from "./team-email.server";

export async function emailStaffTeams(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
}) {
  const access = await resolveStaffAccess(input);
  const assignment = staffAssignmentForPermission(access, "manageTeams");
  if (!access || !assignment) {
    return { ok: false as const, status: 403, error: "This staff link cannot manage teams" };
  }
  return sendEventTeamEmails({
    eventSlug: input.eventSlug,
    actorId: assignment.id,
    deviceId: input.deviceId,
  });
}

export async function getStaffOperationsPage(input: {
  eventSlug: string;
  token: string;
  deviceId: string;
}) {
  const access = await resolveStaffAccess(input);
  const assignment = access?.assignments[0];
  if (!access || !assignment) return { found: false as const };

  const grant = (permission: Parameters<typeof staffAssignmentForPermission>[1]) =>
    staffAssignmentForPermission(access, permission);
  const canAdmit = grant("admitTickets") !== null;
  const canScanCheckpoints = grant("scanCheckpoints") !== null;
  const canManageTeams = grant("manageTeams") !== null;
  const canManageGuestPhotos = grant("manageGuestPhotos") !== null;
  const canRequestGuests = grant("requestGuests") !== null;
  const canAddGuests = grant("addGuests") !== null;
  const canApproveGuests = grant("approveRequests") !== null;

  const [
    event,
    checkpoints,
    teams,
    teamRoster,
    guestRequests,
    drop,
    mediaSchedule,
    guestPhotosAvailable,
    doorTickets,
  ] = await Promise.all([
    getEvent(input.eventSlug),
    canScanCheckpoints ? listCheckpoints(input.eventSlug) : [],
    canManageTeams ? listTeams(input.eventSlug) : [],
    canManageTeams ? listCheckedInTeamParticipants(input.eventSlug) : [],
    canApproveGuests
      ? listGuestRequests(input.eventSlug, "pending")
      : canRequestGuests || canAddGuests
        ? Promise.all(
            access.assignments.map((entry) => listGuestRequestsForToken(`staff:${entry.id}`)),
          ).then((entries) => entries.flat())
        : [],
    canManageGuestPhotos ? getEventDrop(input.eventSlug) : null,
    canManageGuestPhotos ? getEventDropSchedule(input.eventSlug) : null,
    canManageGuestPhotos ? isCapabilityEffective(input.eventSlug, "guestPhotos") : false,
    canAdmit || canScanCheckpoints ? listTicketsForEvent(input.eventSlug) : [],
  ]);
  if (!event) return { found: false as const };

  return {
    found: true as const,
    eventSlug: input.eventSlug,
    eventTitle: event.title,
    eventStartsAt: event.startsAt,
    label: access.assignments.map((entry) => entry.label).join(" · "),
    personId: assignment.personId,
    rolePreset:
      assignment.rolePreset ??
      (typeof assignment.scope.rolePreset === "string" ? assignment.scope.rolePreset : undefined),
    expiresAt: assignment.expiresAt,
    assignmentType: assignment.assignmentType,
    canAdmit,
    doorTickets: doorTickets.map((ticket) => ({
      id: ticketPublicId(ticket),
      orderId: ticket.orderId,
      holderName: ticket.holderName,
      ticketTypeName:
        event.ticketTypes.find((ticketType) => ticketType.id === ticket.ticketTypeId)?.name ??
        "Ticket",
      status: ticket.status,
      redeemedAt: ticket.redeemedAt,
    })),
    canScanCheckpoints,
    canManageTeams,
    canManageGuestPhotos,
    guestPhotosAvailable,
    mediaDrop: drop
      ? {
          uploadPath: drop.live ? `/drop/${drop.token}` : undefined,
          albumPath: drop.available ? `/t/${drop.transferId}` : undefined,
          expiresAt: drop.expiresAt,
        }
      : undefined,
    mediaSchedule:
      mediaSchedule && !mediaSchedule.openedAt && !mediaSchedule.cancelledAt
        ? { opensAt: mediaSchedule.opensAt }
        : undefined,
    canRequestGuests,
    canAddGuests,
    canApproveGuests,
    guestRequests,
    teams,
    teamRoster,
    checkpoints: checkpoints.filter((checkpoint) =>
      access.assignments.some((entry) => {
        if (!entry.permissions.scanCheckpoints) return false;
        const scoped = entry.scope.checkpointIds;
        return !Array.isArray(scoped) || scoped.length === 0 || scoped.includes(checkpoint.id);
      }),
    ),
  };
}

export type StaffOperationsPageData = Extract<
  Awaited<ReturnType<typeof getStaffOperationsPage>>,
  { found: true }
>;
