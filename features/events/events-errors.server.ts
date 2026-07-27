import { Data } from "effect";

/**
 * Typed failures for the events subsystem.
 *
 * `retryable` distinguishes a timeout or transport blip from a rejection the
 * caller caused, so the door client knows whether trying again is sensible.
 */
export class EventsOperationError extends Data.TaggedError("EventsOperationError")<{
  readonly cause: unknown;
  readonly domain: EventsDomain;
  readonly operation: string;
  readonly retryable: boolean;
}> {
  override get message() {
    return `${this.domain}.${this.operation} failed`;
  }
}

export type EventsDomain = "events" | "tickets";
