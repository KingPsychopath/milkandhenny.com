import { Effect } from "effect";
import { AttendeeOperationsService } from "./attendee-operations-service.server";
import { runEventsEffect } from "@/features/events/events-runtime.server";

export type AdminInboxViewer = {
  actorId: string;
  actorType: "admin" | "root-owner";
};

export type AdminInboxFilters = {
  status?: "new" | "in-progress" | "resolved" | "dismissed";
  severity?: "info" | "prompt" | "warning" | "critical";
  category?: string;
  eventSlug?: string;
  active?: boolean;
};

/** Shared read path for the admin workspace and the HTTP/CLI contract. */
export function loadAdminInbox(
  viewer: AdminInboxViewer,
  filters: AdminInboxFilters,
  signal: AbortSignal,
) {
  return runEventsEffect(
    Effect.gen(function* () {
      const service = yield* AttendeeOperationsService;
      return yield* service.loadInbox({ viewer, ...filters });
    }),
    signal,
  );
}
