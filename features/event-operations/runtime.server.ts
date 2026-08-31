/** Compatibility exports while event-operation callers move to the single events runtime. */
export {
  runEventsEffect as runEventOperationsEffect,
  runEventsResult as runEventOperationsResult,
} from "@/features/events/events-runtime.server";
export type {
  EventsRunResult as EventOperationsResult,
  EventsServices as EventOperationsServices,
} from "@/features/events/events-runtime.server";
