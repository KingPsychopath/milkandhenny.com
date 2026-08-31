import { randomBytes } from "node:crypto";

import type { PoolClient } from "pg";

import { getEvent } from "@/features/events/store.server";
import { confirmManagedEventGameResult } from "@/features/event-scoring/game-launch.server";
import { getParticipant } from "@/features/event-scoring/store.server";
import {
  COLOURS,
  createEmptyLedger,
  recordEncounter,
  type Colour,
  type EncounterOutcome,
  type IcebreakerLedger,
  type IcebreakerPlayer,
} from "@/features/things/icebreaker/icebreaker-pairing";
import { query, transaction } from "@/lib/platform/postgres.server";

type ProfileRow = {
  participant_id: string;
  event_slug: string;
  player_code: string;
  colour_code: Colour["code"];
};

type EncounterRow = {
  partner_code: string;
  partner_colour_code: Colour["code"];
  first_met_at: Date;
  last_met_at: Date;
};

const ICEBREAKER_SCORING_ACTIVITY_NAME = "Icebreaker mix";

export type EventIcebreakerResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const PLAYER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function colour(code: string): Colour | null {
  return COLOURS.find((candidate) => candidate.code === code) ?? null;
}

function player(row: ProfileRow): IcebreakerPlayer {
  const assigned = colour(row.colour_code);
  if (!assigned) throw new Error("Stored icebreaker colour is invalid");
  return { id: row.player_code, colour: assigned };
}

function randomPlayerCode(): string {
  return Array.from(randomBytes(5), (byte) => PLAYER_ALPHABET[byte % PLAYER_ALPHABET.length]).join(
    "",
  );
}

async function profileWithClient(
  client: PoolClient,
  eventSlug: string,
  participantId: string,
): Promise<ProfileRow | null> {
  const existing = await client.query<ProfileRow>(
    `select participant_id, event_slug, player_code, colour_code
       from event_icebreaker_profiles
      where participant_id = $1 and event_slug = $2`,
    [participantId, eventSlug],
  );
  if (existing.rows[0]) return existing.rows[0];

  const counts = await client.query<{ colour_code: string; count: string }>(
    `select colour_code, count(*)::text as count
       from event_icebreaker_profiles
      where event_slug = $1
      group by colour_code`,
    [eventSlug],
  );
  const byColour = new Map(counts.rows.map((row) => [row.colour_code, Number(row.count)]));
  const smallest = Math.min(...COLOURS.map((candidate) => byColour.get(candidate.code) ?? 0));
  const available = COLOURS.filter((candidate) => (byColour.get(candidate.code) ?? 0) === smallest);
  let hash = 2166136261;
  for (const character of participantId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const assigned = available[(hash >>> 0) % available.length] ?? COLOURS[0];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomPlayerCode();
    const inserted = await client.query<ProfileRow>(
      `insert into event_icebreaker_profiles (
         participant_id, event_slug, player_code, colour_code
       ) values ($1,$2,$3,$4)
       on conflict do nothing
       returning participant_id, event_slug, player_code, colour_code`,
      [participantId, eventSlug, code, assigned.code],
    );
    if (inserted.rows[0]) return inserted.rows[0];
  }
  throw new Error("Could not allocate an icebreaker identity");
}

async function ledgerForProfile(profile: ProfileRow): Promise<IcebreakerLedger> {
  const owner = player(profile);
  const rows = await query<EncounterRow>(
    `select partner.player_code as partner_code,
            partner.colour_code as partner_colour_code,
            encounter.first_met_at, encounter.last_met_at
       from event_icebreaker_encounters encounter
       join event_icebreaker_profiles partner
         on partner.participant_id = case
              when encounter.participant_a_id = $2 then encounter.participant_b_id
              else encounter.participant_a_id
            end
      where encounter.event_slug = $1
        and (encounter.participant_a_id = $2 or encounter.participant_b_id = $2)
      order by encounter.last_met_at desc
      limit 100`,
    [profile.event_slug, profile.participant_id],
  );
  let ledger = createEmptyLedger(owner);
  for (const row of rows.toReversed()) {
    const partnerColour = colour(row.partner_colour_code);
    if (!partnerColour) continue;
    ledger = recordEncounter(
      ledger,
      owner,
      { id: row.partner_code, colour: partnerColour },
      row.first_met_at.toISOString(),
    ).ledger;
    const encounter = ledger.encounters[0];
    if (encounter) encounter.lastMetAt = row.last_met_at.toISOString();
  }
  return ledger;
}

export async function getEventIcebreaker(
  eventSlug: string,
  participantId: string,
): Promise<EventIcebreakerResult<{ player: IcebreakerPlayer; ledger: IcebreakerLedger }>> {
  const [event, participant] = await Promise.all([
    getEvent(eventSlug),
    getParticipant(participantId),
  ]);
  if (!event || event.arrivalExperience !== "icebreaker") {
    return { ok: false, status: 404, error: "This event icebreaker is not open" };
  }
  if (!participant || participant.eventSlug !== eventSlug || participant.status !== "active") {
    return { ok: false, status: 404, error: "Event ticket not found" };
  }
  if (!participant.checkedInAt) {
    return { ok: false, status: 409, error: "Check in at the door to reveal your colour" };
  }

  const profile = await transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`icebreaker:${eventSlug}`]);
    const stored = await profileWithClient(client, eventSlug, participantId);
    return stored;
  });
  if (!profile) throw new Error("Could not load an icebreaker profile");
  return { ok: true, value: { player: player(profile), ledger: await ledgerForProfile(profile) } };
}

export async function addEventIcebreakerEncounter(input: {
  eventSlug: string;
  participantId: string;
  partnerCode: string;
}): Promise<EventIcebreakerResult<EncounterOutcome>> {
  const current = await getEventIcebreaker(input.eventSlug, input.participantId);
  if (!current.ok) return current;
  if (input.partnerCode === current.value.player.id) {
    return {
      ok: true,
      value: recordEncounter(
        current.value.ledger,
        current.value.player,
        current.value.player,
        new Date().toISOString(),
      ),
    };
  }
  const partnerRows = await query<ProfileRow>(
    `select participant_id, event_slug, player_code, colour_code
       from event_icebreaker_profiles
      where event_slug = $1 and player_code = $2`,
    [input.eventSlug, input.partnerCode],
  );
  const partnerProfile = partnerRows[0];
  if (!partnerProfile) {
    return { ok: false, status: 404, error: "That code is not part of this event" };
  }
  const [first, second] = [input.participantId, partnerProfile.participant_id].sort();
  const rows = await query<{ first_met_at: Date; last_met_at: Date; times_met: number }>(
    `insert into event_icebreaker_encounters (
       event_slug, participant_a_id, participant_b_id
     ) values ($1,$2,$3)
     on conflict (event_slug, participant_a_id, participant_b_id) do update set
       last_met_at = now(), times_met = event_icebreaker_encounters.times_met + 1
     returning first_met_at, last_met_at, times_met`,
    [input.eventSlug, first, second],
  );
  const stored = rows[0];
  const activities = await query<{ id: string }>(
    `select id from score_activities
      where event_slug = $1 and status = 'live' and template = 'discovery'
        and lower(name) = lower($2)
      order by created_at desc, id desc limit 1`,
    [input.eventSlug, ICEBREAKER_SCORING_ACTIVITY_NAME],
  );
  const activityId = activities[0]?.id;
  if (activityId) {
    const scoring = await confirmManagedEventGameResult({
      kind: "icebreaker",
      eventSlug: input.eventSlug,
      activityId,
      gameInstanceId: `mix:${first}:${second}`,
      resultId: "first-mix",
      participantIds: [first, second],
    });
    if (!scoring.ok) {
      return {
        ok: false,
        status: scoring.status,
        error: "Your mix was saved, but its points could not be added. Try the scan again.",
      };
    }
  }
  const outcome = recordEncounter(
    current.value.ledger,
    current.value.player,
    player(partnerProfile),
    stored?.last_met_at.toISOString() ?? new Date().toISOString(),
  );
  return {
    ok: true,
    value: { ...outcome, persisted: true, status: stored?.times_met === 1 ? "new" : "repeat" },
  };
}
