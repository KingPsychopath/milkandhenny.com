import { randomUUID } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import {
  ATTENDEE_CAPABILITIES,
  DEFAULT_GLOBAL_AVAILABILITY,
  DEFAULT_NEW_EVENT_CAPABILITIES,
  capabilityMap,
  effectiveCapability,
  type AttendeeCapability,
  type CapabilityMap,
  type EventOperationsPolicy,
  type GlobalOperationsSettings,
} from "./types";

type GlobalRow = {
  global_availability: unknown;
  new_event_defaults: unknown;
  emergency_paused: unknown;
  revision: string | number;
  updated_by: string;
  update_reason: string | null;
  updated_at: Date;
};

type EventRow = {
  event_slug: string;
  capabilities: unknown;
  transfer_opens_at: Date | null;
  transfer_closes_at: Date | null;
  policy_version: string | number;
  updated_by: string;
  update_reason: string | null;
  updated_at: Date;
};

function toGlobal(row: GlobalRow): GlobalOperationsSettings {
  return {
    globalAvailability: capabilityMap(row.global_availability, DEFAULT_GLOBAL_AVAILABILITY),
    newEventDefaults: capabilityMap(row.new_event_defaults, DEFAULT_NEW_EVENT_CAPABILITIES),
    emergencyPaused: capabilityMap(row.emergency_paused, DEFAULT_NEW_EVENT_CAPABILITIES),
    revision: Number(row.revision),
    updatedBy: row.updated_by,
    updateReason: row.update_reason ?? undefined,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toEvent(row: EventRow): EventOperationsPolicy {
  return {
    eventSlug: row.event_slug,
    capabilities: capabilityMap(row.capabilities, DEFAULT_NEW_EVENT_CAPABILITIES),
    transferOpensAt: row.transfer_opens_at?.toISOString(),
    transferClosesAt: row.transfer_closes_at?.toISOString(),
    policyVersion: Number(row.policy_version),
    updatedBy: row.updated_by,
    updateReason: row.update_reason ?? undefined,
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getGlobalOperationsSettings(): Promise<GlobalOperationsSettings> {
  const row = await queryOne<GlobalRow>(
    `select * from attendee_operation_settings where id = true`,
  );
  if (!row) throw new Error("Attendee Operations settings are unavailable");
  return toGlobal(row);
}

export async function getEventOperationsPolicy(eventSlug: string): Promise<EventOperationsPolicy> {
  return transaction(async (client) => {
    const existing = await client.query<EventRow>(
      `select * from event_operation_policies where event_slug = $1`,
      [eventSlug],
    );
    if (existing.rows[0]) return toEvent(existing.rows[0]);
    const settings = await client.query<GlobalRow>(
      `select * from attendee_operation_settings where id = true`,
    );
    const global = settings.rows[0];
    if (!global) throw new Error("Attendee Operations settings are unavailable");
    const scoring = await client.query<{ state: string; leaderboard_visibility: string }>(
      `select state,leaderboard_visibility from event_scoring_settings where event_slug = $1`,
      [eventSlug],
    );
    const discoveries = await client.query(
      `select 1 from score_discoveries where event_slug = $1 limit 1`,
      [eventSlug],
    );
    const event = await client.query<{ transferable: boolean }>(
      `select transferable from events where slug = $1`,
      [eventSlug],
    );
    if (!event.rows[0]) throw new Error("Event not found");
    const base = capabilityMap(global.new_event_defaults, DEFAULT_NEW_EVENT_CAPABILITIES);
    const capabilities: CapabilityMap = {
      ...base,
      scoring: scoring.rows[0]?.state !== undefined && scoring.rows[0].state !== "off",
      publicLeaderboard:
        scoring.rows[0]?.leaderboard_visibility !== undefined &&
        scoring.rows[0].leaderboard_visibility !== "hidden",
      manualStaffAwards: scoring.rows[0]?.state !== undefined && scoring.rows[0].state !== "off",
      discoveries: Boolean(discoveries.rowCount),
      transfers: false,
      onwardTransfers: false,
      complimentaryTransfers: false,
    };
    const inserted = await client.query<EventRow>(
      `insert into event_operation_policies (event_slug,capabilities,updated_by)
       values ($1,$2::jsonb,'system-snapshot') returning *`,
      [eventSlug, JSON.stringify(capabilities)],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Event policy could not be created");
    return toEvent(row);
  });
}

export async function updateGlobalOperationsSettings(input: {
  section: "globalAvailability" | "newEventDefaults" | "emergencyPaused";
  values: Partial<CapabilityMap>;
  actorId: string;
  reason?: string;
}): Promise<GlobalOperationsSettings> {
  if (
    (input.section === "globalAvailability" || input.section === "emergencyPaused") &&
    !input.reason?.trim()
  ) {
    throw new Error("Global capability changes require a reason");
  }
  return transaction(async (client) => {
    const selected = await client.query<GlobalRow>(
      `select * from attendee_operation_settings where id = true for update`,
    );
    const before = selected.rows[0];
    if (!before) throw new Error("Attendee Operations settings are unavailable");
    const current = toGlobal(before);
    const base = current[input.section];
    const next = { ...base };
    for (const capability of ATTENDEE_CAPABILITIES) {
      if (typeof input.values[capability] === "boolean")
        next[capability] = input.values[capability];
    }
    const column =
      input.section === "globalAvailability"
        ? "global_availability"
        : input.section === "newEventDefaults"
          ? "new_event_defaults"
          : "emergency_paused";
    const updated = await client.query<GlobalRow>(
      `update attendee_operation_settings
          set ${column} = $1::jsonb, revision = revision + 1,
              updated_by = $2, update_reason = $3, updated_at = now()
        where id = true returning *`,
      [JSON.stringify(next), input.actorId, input.reason?.trim() || null],
    );
    const after = updated.rows[0];
    if (!after) throw new Error("Attendee Operations settings could not be updated");
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,entity_type,entity_id,before_state,after_state,reason,correlation_id)
       values ('settings.global.updated','root-owner',$1,'settings','global',$2::jsonb,$3::jsonb,$4,$5)`,
      [
        input.actorId,
        JSON.stringify({ section: input.section, values: base }),
        JSON.stringify({ section: input.section, values: next }),
        input.reason?.trim() || null,
        randomUUID(),
      ],
    );
    return toGlobal(after);
  });
}

export async function updateEventOperationsPolicy(input: {
  eventSlug: string;
  capabilities?: Partial<CapabilityMap>;
  transferOpensAt?: string | null;
  transferClosesAt?: string | null;
  actorId: string;
  reason?: string;
}): Promise<EventOperationsPolicy> {
  await getEventOperationsPolicy(input.eventSlug);
  return transaction(async (client) => {
    const selected = await client.query<EventRow>(
      `select * from event_operation_policies where event_slug = $1 for update`,
      [input.eventSlug],
    );
    const before = selected.rows[0];
    if (!before) throw new Error("Event policy is unavailable");
    const current = toEvent(before);
    const next = { ...current.capabilities };
    for (const capability of ATTENDEE_CAPABILITIES) {
      if (typeof input.capabilities?.[capability] === "boolean")
        next[capability] = input.capabilities[capability];
    }
    const opens =
      input.transferOpensAt === undefined ? current.transferOpensAt : input.transferOpensAt;
    const closes =
      input.transferClosesAt === undefined ? current.transferClosesAt : input.transferClosesAt;
    if (opens && !Number.isFinite(Date.parse(opens)))
      throw new Error("Transfer opening time is invalid");
    if (closes && !Number.isFinite(Date.parse(closes)))
      throw new Error("Transfer closing time is invalid");
    if (opens && closes && Date.parse(closes) <= Date.parse(opens))
      throw new Error("Transfer closing time must follow its opening time");
    const updated = await client.query<EventRow>(
      `update event_operation_policies
          set capabilities = $2::jsonb, transfer_opens_at = $3, transfer_closes_at = $4,
              policy_version = policy_version + 1, updated_by = $5,
              update_reason = $6, updated_at = now()
        where event_slug = $1 returning *`,
      [
        input.eventSlug,
        JSON.stringify(next),
        opens ?? null,
        closes ?? null,
        input.actorId,
        input.reason?.trim() || null,
      ],
    );
    const after = updated.rows[0];
    if (!after) throw new Error("Event policy could not be updated");
    await client.query(
      `insert into attendee_operations_audit_events
         (action,actor_type,actor_id,event_slug,entity_type,entity_id,before_state,after_state,reason,correlation_id)
       values ('settings.event.updated','admin',$1,$2,'event-policy',$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [
        input.actorId,
        input.eventSlug,
        JSON.stringify(current),
        JSON.stringify(toEvent(after)),
        input.reason?.trim() || null,
        randomUUID(),
      ],
    );
    return toEvent(after);
  });
}

export async function isCapabilityEffective(
  eventSlug: string,
  capability: AttendeeCapability,
): Promise<boolean> {
  const [global, event] = await Promise.all([
    getGlobalOperationsSettings(),
    getEventOperationsPolicy(eventSlug),
  ]);
  return effectiveCapability(global, event, capability);
}

export async function countCapabilityImpact(capability: AttendeeCapability): Promise<number> {
  const rows = await query<{ count: string }>(
    `select count(*)::text as count from event_operation_policies
      where coalesce((capabilities->>$1)::boolean, false)`,
    [capability],
  );
  return Number(rows[0]?.count) || 0;
}
