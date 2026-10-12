import { runEventsEffect } from "@/features/events/events-runtime.server";
import { isSonderMode, object } from "./types";
import {
  acknowledgeSonderOrder,
  prepareSonderTeams,
  allocateSonderBookings,
  assignSonderBooking,
  configureSonderEvent,
  previewSonderTeamEmails,
  queueSonderTeamEmails,
  readSonderEvent,
  sonderOperation,
  syncSonderEvent,
} from "./sonder.server";

export async function executeSonderAction(
  slug: string,
  value: unknown,
  actorId: string,
  signal: AbortSignal,
) {
  const body = object(value);
  return runEventsEffect(
    sonderOperation("admin", async (operationSignal) => {
      switch (body.action) {
        case "configure":
          if (
            typeof body.hangoutId !== "string" ||
            !isSonderMode(body.mode) ||
            typeof body.bookingUrl !== "string"
          )
            throw new Error("Invalid Sonder mapping");
          await configureSonderEvent(slug, {
            hangoutId: body.hangoutId,
            mode: body.mode,
            bookingUrl: body.bookingUrl,
            cancelledAt: null,
          });
          break;
        case "sync":
          await syncSonderEvent(slug, operationSignal);
          break;
        case "allocate":
          if (body.teamCount !== undefined) await prepareSonderTeams(slug, body.teamCount);
          await allocateSonderBookings(slug, actorId);
          break;
        case "review":
          if (typeof body.orderId !== "string" || typeof body.revision !== "string")
            throw new Error("Choose the current booking revision");
          await acknowledgeSonderOrder(slug, body.orderId, body.revision, actorId);
          break;
        case "assign":
          if (typeof body.orderId !== "string" || typeof body.teamId !== "string")
            throw new Error("Choose a booking and team");
          await assignSonderBooking(slug, body.orderId, body.teamId, actorId);
          break;
        case "preview":
          return { preview: await previewSonderTeamEmails(slug) };
        case "send":
          if (typeof body.previewRevision !== "string")
            throw new Error("Preview emails before sending");
          return { sent: await queueSonderTeamEmails(slug, body.previewRevision) };
        default:
          throw new Error("Unknown Sonder action");
      }
      return { view: await readSonderEvent(slug) };
    }),
    signal,
  );
}
