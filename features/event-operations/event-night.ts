import type { EventNightContext } from "./event-night.types";

const EVENT_WINDOW_BEFORE_MS = 6 * 60 * 60 * 1_000;
const EVENT_WINDOW_AFTER_MS = 12 * 60 * 60 * 1_000;

export function isCurrentEvent(context: EventNightContext, now = Date.now()) {
  if (context.eventStatus === "cancelled" || context.eventStatus === "archived") return false;
  const startsAt = Date.parse(context.doorsAt ?? context.startsAt);
  const endsAt = context.endsAt ? Date.parse(context.endsAt) : startsAt + 8 * 60 * 60 * 1_000;
  return now >= startsAt - EVENT_WINDOW_BEFORE_MS && now <= endsAt + EVENT_WINDOW_AFTER_MS;
}

export function eventNightStatus(
  context: EventNightContext,
  online: boolean,
  claims: { pending: number; rejected: number },
) {
  if (claims.rejected > 0)
    return claims.rejected === 1 ? "one claim needs help" : `${claims.rejected} claims need help`;
  if (claims.pending > 0)
    return claims.pending === 1
      ? "one claim saved · confirming"
      : `${claims.pending} claims saved · confirming`;
  if (context.eventStatus === "cancelled") return "event cancelled";
  if (context.eventStatus === "archived") return `${context.points} confirmed · event ended`;
  if (context.eventStatus === "draft") return "event not published";
  if (!online) return `${context.points} confirmed · offline`;
  if (!context.active) return "choose the ticket receiving points";
  if (context.scoringState === "ready") return "points ticket selected · scoring not open";
  if (context.scoringState === "frozen") return `${context.points} confirmed · scoring frozen`;
  if (context.scoringState === "closed") return `${context.points} confirmed · scoring closed`;
  if (context.scoringState === "off") return "ticket connected · scoring off";
  return context.checkedIn
    ? `${context.points} confirmed · checked in`
    : `${context.points} confirmed · not checked in`;
}
