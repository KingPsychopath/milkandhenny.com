import { listEvents } from "@/features/events/store.server";
import {
  countCapabilityImpact,
  getEventOperationsPolicy,
  getGlobalOperationsSettings,
} from "./capabilities.server";
import { ATTENDEE_CAPABILITIES, effectiveCapability } from "./types";

export async function getAdminOperationsSettings() {
  const events = await listEvents({ includeHidden: true });
  const [global, policies, impactCounts] = await Promise.all([
    getGlobalOperationsSettings(),
    Promise.all(events.map((event) => getEventOperationsPolicy(event.slug))),
    Promise.all(ATTENDEE_CAPABILITIES.map((capability) => countCapabilityImpact(capability))),
  ]);
  return {
    global,
    impact: Object.fromEntries(
      ATTENDEE_CAPABILITIES.map((capability, index) => [capability, impactCounts[index]]),
    ) as Record<(typeof ATTENDEE_CAPABILITIES)[number], number>,
    events: events.map((event, index) => ({
      slug: event.slug,
      title: event.title,
      status: event.status,
      policy: policies[index]!,
      effective: Object.fromEntries(
        ATTENDEE_CAPABILITIES.map((capability) => [
          capability,
          effectiveCapability(global, policies[index]!, capability),
        ]),
      ) as typeof global.globalAvailability,
    })),
  };
}
