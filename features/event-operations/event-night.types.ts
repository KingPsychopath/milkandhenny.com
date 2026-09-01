import type { ScoringState } from "@/features/event-scoring/types";
import type { EventStatus } from "@/features/events/types";

/** One authoritative attendee context for one event on the current browser/account. */
export type EventNightContext = {
  eventSlug: string;
  eventTitle: string;
  eventStatus: EventStatus;
  startsAt: string;
  doorsAt?: string;
  endsAt?: string;
  ticketId: string;
  participantId: string;
  holderName: string;
  active: boolean;
  checkedIn: boolean;
  savedToAccount: boolean;
  points: number;
  revision: number;
  scoringState: ScoringState;
  lastConfirmedAt?: string;
  selectedAt: string;
};
