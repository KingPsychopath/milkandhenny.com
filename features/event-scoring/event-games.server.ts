import { randomBytes } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";

export type EventGameRegisterItem = {
  id: string;
  gameKey: string;
  label: string;
  playMode: "pooled" | "hosted" | "table";
  poolEntranceId?: string;
  awardMethod: "staff" | "automatic";
  activityIds: string[];
  status: "included" | "paused";
};

type EventGameRegisterRow = {
  id: string;
  game_key: string;
  label: string;
  play_mode: EventGameRegisterItem["playMode"];
  pool_entrance_id: string | null;
  award_method: EventGameRegisterItem["awardMethod"];
  activity_ids: string[];
  status: EventGameRegisterItem["status"];
};

function itemFromRow(row: EventGameRegisterRow): EventGameRegisterItem {
  return {
    id: row.id,
    gameKey: row.game_key,
    label: row.label,
    playMode: row.play_mode,
    poolEntranceId: row.pool_entrance_id ?? undefined,
    awardMethod: row.award_method,
    activityIds: row.activity_ids,
    status: row.status,
  };
}

export async function listEventGameRegister(eventSlug: string) {
  const rows = await query<EventGameRegisterRow>(
    `select id,game_key,label,play_mode,pool_entrance_id,award_method,activity_ids,status
       from event_game_register
      where event_slug = $1
      order by status, label, id`,
    [eventSlug],
  );
  return rows.map(itemFromRow);
}

export async function upsertEventGameRegisterItem(input: {
  eventSlug: string;
  actorId: string;
  gameKey: string;
  label: string;
  playMode: EventGameRegisterItem["playMode"];
  poolEntranceId?: string;
  awardMethod: EventGameRegisterItem["awardMethod"];
  activityIds: string[];
  status: EventGameRegisterItem["status"];
}): Promise<
  { ok: true; value: EventGameRegisterItem } | { ok: false; status: number; error: string }
> {
  const gameKey = input.gameKey.trim().toLowerCase();
  const label = input.label.trim();
  const activityIds = [...new Set(input.activityIds.filter(Boolean))];
  if (!/^[a-z0-9-]{1,80}$/.test(gameKey) || !label || label.length > 120) {
    return { ok: false, status: 400, error: "Choose a valid game and label" };
  }
  if (input.playMode === "pooled" && !input.poolEntranceId) {
    return { ok: false, status: 400, error: "Choose a pooled entrance" };
  }
  if (input.playMode !== "pooled" && input.poolEntranceId) {
    return { ok: false, status: 400, error: "Only pooled games use a pooled entrance" };
  }
  if (activityIds.length === 0) {
    return { ok: false, status: 400, error: "Choose at least one scoring activity" };
  }
  if (input.awardMethod === "automatic" && activityIds.length !== 1) {
    return { ok: false, status: 400, error: "Automatic results use one combined scoring activity" };
  }

  return transaction(async (client) => {
    const activities = await client.query<{ id: string }>(
      `select id from score_activities where event_slug = $1 and id = any($2::text[])`,
      [input.eventSlug, activityIds],
    );
    if (activities.rowCount !== activityIds.length) {
      return { ok: false as const, status: 400, error: "One or more activities are invalid" };
    }
    const id = `egr_${randomBytes(18).toString("base64url")}`;
    const result = await client.query<EventGameRegisterRow>(
      `insert into event_game_register
         (id,event_slug,game_key,label,play_mode,pool_entrance_id,award_method,
          activity_ids,status,created_by)
       select $1,events.slug,$3,$4,$5,$6,$7,$8,$9,$10
         from events where events.slug = $2
       on conflict (event_slug, game_key) do update set
         label = excluded.label,
         play_mode = excluded.play_mode,
         pool_entrance_id = excluded.pool_entrance_id,
         award_method = excluded.award_method,
         activity_ids = excluded.activity_ids,
         status = excluded.status,
         updated_at = now()
       returning id,game_key,label,play_mode,pool_entrance_id,award_method,activity_ids,status`,
      [
        id,
        input.eventSlug,
        gameKey,
        label,
        input.playMode,
        input.poolEntranceId ?? null,
        input.awardMethod,
        activityIds,
        input.status,
        input.actorId,
      ],
    );
    const row = result.rows[0];
    return row
      ? { ok: true as const, value: itemFromRow(row) }
      : { ok: false as const, status: 404, error: "Event not found" };
  });
}

export async function removeEventGameRegisterItem(input: {
  eventSlug: string;
  gameKey: string;
}): Promise<{ ok: true; value: { removed: true } } | { ok: false; status: number; error: string }> {
  const row = await queryOne<{ game_key: string }>(
    `delete from event_game_register where event_slug = $1 and game_key = $2 returning game_key`,
    [input.eventSlug, input.gameKey],
  );
  return row
    ? { ok: true, value: { removed: true } }
    : { ok: false, status: 404, error: "Included game not found" };
}

export async function findAutomaticPooledEventGame(token: string) {
  return queryOne<{
    event_slug: string;
    activity_id: string;
    game_key: string;
  }>(
    `select register.event_slug,
            register.activity_ids[1] as activity_id,
            register.game_key
       from event_game_register register
       join game_pool_entrances entrance on entrance.id = register.pool_entrance_id
      where entrance.token = $1
        and entrance.retired_at is null
        and register.status = 'included'
        and register.play_mode = 'pooled'
        and register.award_method = 'automatic'
        and cardinality(register.activity_ids) = 1`,
    [token],
  );
}
