import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { GAME_POOL_DEFAULTS, gamePoolPreset, isGamePoolGame } from "./presets";
import type {
  GamePoolEntrance,
  GamePoolGame,
  GamePoolNameVisibility,
  GamePoolPreset,
  GamePoolRun,
} from "./types";

interface EntranceRow {
  id: string;
  token: string;
  label: string;
  game: string;
  preset: unknown;
  target_size: number;
  allow_room_choice: boolean;
  allow_new_rooms: boolean;
  name_visibility: string;
  created_at: Date;
  updated_at: Date;
  retired_at: Date | null;
  run_id: string | null;
  run_status: string | null;
  run_preset: unknown;
  run_target_size: number | null;
  run_allow_room_choice: boolean | null;
  run_allow_new_rooms: boolean | null;
  run_name_visibility: string | null;
  run_opened_at: Date | null;
  run_closes_at: Date | null;
  run_closed_at: Date | null;
}

const ENTRANCE_SELECT = `
  select
    e.*,
    r.id as run_id,
    r.status as run_status,
    r.preset as run_preset,
    r.target_size as run_target_size,
    r.allow_room_choice as run_allow_room_choice,
    r.allow_new_rooms as run_allow_new_rooms,
    r.name_visibility as run_name_visibility,
    r.opened_at as run_opened_at,
    r.closes_at as run_closes_at,
    r.closed_at as run_closed_at
  from game_pool_entrances e
  left join lateral (
    select * from game_pool_runs candidate
    where candidate.entrance_id = e.id
      and candidate.status in ('open', 'paused')
    order by candidate.opened_at desc
    limit 1
  ) r on true
`;

function opaqueId(prefix: "gpe" | "gpr" | "gpa") {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

function publicToken() {
  return `play_${randomBytes(24).toString("base64url")}`;
}

function visibility(value: string): GamePoolNameVisibility {
  if (value === "initials" || value === "counts") return value;
  return "first-names";
}

function runFromRow(row: EntranceRow, game: GamePoolGame): GamePoolRun | null {
  if (!row.run_id || !row.run_status || !row.run_opened_at) return null;
  const status = row.run_status === "paused" ? "paused" : "open";
  return {
    id: row.run_id,
    entranceId: row.id,
    status,
    preset: gamePoolPreset(row.run_preset, game),
    targetSize: row.run_target_size ?? row.target_size,
    allowRoomChoice: row.run_allow_room_choice ?? row.allow_room_choice,
    allowNewRooms: row.run_allow_new_rooms ?? row.allow_new_rooms,
    nameVisibility: visibility(row.run_name_visibility ?? row.name_visibility),
    openedAt: row.run_opened_at.toISOString(),
    closesAt: row.run_closes_at?.toISOString() ?? null,
    closedAt: row.run_closed_at?.toISOString() ?? null,
  };
}

function entranceFromRow(row: EntranceRow): GamePoolEntrance {
  if (!isGamePoolGame(row.game)) throw new Error("Unsupported game pool record");
  return {
    id: row.id,
    token: row.token,
    label: row.label,
    game: row.game,
    preset: gamePoolPreset(row.preset, row.game),
    targetSize: row.target_size,
    allowRoomChoice: row.allow_room_choice,
    allowNewRooms: row.allow_new_rooms,
    nameVisibility: visibility(row.name_visibility),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    retiredAt: row.retired_at?.toISOString() ?? null,
    run: runFromRow(row, row.game),
  };
}

export async function listGamePoolEntrances() {
  const rows = await query<EntranceRow>(
    `${ENTRANCE_SELECT} order by e.retired_at nulls first, e.created_at desc`,
  );
  return rows.map(entranceFromRow);
}

export async function getGamePoolEntranceByToken(token: string) {
  const row = await queryOne<EntranceRow>(`${ENTRANCE_SELECT} where e.token = $1`, [token]);
  return row ? entranceFromRow(row) : null;
}

export async function getGamePoolEntrance(id: string) {
  const row = await queryOne<EntranceRow>(`${ENTRANCE_SELECT} where e.id = $1`, [id]);
  return row ? entranceFromRow(row) : null;
}

export async function createGamePoolEntrance(input: {
  game: GamePoolGame;
  label?: string;
  preset?: unknown;
  targetSize?: number;
  allowRoomChoice?: boolean;
  allowNewRooms?: boolean;
  nameVisibility?: GamePoolNameVisibility;
}) {
  const defaults = GAME_POOL_DEFAULTS[input.game];
  const targetSize = Math.max(
    2,
    Math.min(defaults.capacity, Math.floor(input.targetSize ?? defaults.targetSize)),
  );
  const id = opaqueId("gpe");
  const token = publicToken();
  await query(
    `insert into game_pool_entrances (
      id, token, label, game, preset, target_size,
      allow_room_choice, allow_new_rooms, name_visibility
    ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
    [
      id,
      token,
      input.label?.trim().slice(0, 80) || defaults.label,
      input.game,
      JSON.stringify(gamePoolPreset(input.preset, input.game)),
      targetSize,
      input.allowRoomChoice ?? true,
      input.allowNewRooms ?? true,
      input.nameVisibility ?? "first-names",
    ],
  );
  const entrance = await getGamePoolEntrance(id);
  if (!entrance) throw new Error("Game entrance was not created");
  return entrance;
}

export async function updateGamePoolEntrance(
  id: string,
  input: {
    label?: string;
    preset?: unknown;
    targetSize?: number;
    allowRoomChoice?: boolean;
    allowNewRooms?: boolean;
    nameVisibility?: GamePoolNameVisibility;
    rotateToken?: boolean;
    retire?: boolean;
  },
) {
  const current = await getGamePoolEntrance(id);
  if (!current) return null;
  if (current.run && (input.rotateToken || input.retire))
    throw new Error("Close the current game night before you change its player link");
  const capacity = GAME_POOL_DEFAULTS[current.game].capacity;
  const label = input.label?.trim().slice(0, 80) || current.label;
  const preset = gamePoolPreset(input.preset ?? current.preset, current.game);
  const targetSize = Math.max(
    2,
    Math.min(capacity, Math.floor(input.targetSize ?? current.targetSize)),
  );
  await query(
    `update game_pool_entrances set
      label = $2,
      preset = $3::jsonb,
      target_size = $4,
      allow_room_choice = $5,
      allow_new_rooms = $6,
      name_visibility = $7,
      token = case when $8 then $9 else token end,
      retired_at = case
        when $10::boolean is null then retired_at
        when $10 then coalesce(retired_at, now())
        else null
      end,
      updated_at = now()
    where id = $1`,
    [
      id,
      label,
      JSON.stringify(preset),
      targetSize,
      input.allowRoomChoice ?? current.allowRoomChoice,
      input.allowNewRooms ?? current.allowNewRooms,
      input.nameVisibility ?? current.nameVisibility,
      input.rotateToken === true,
      publicToken(),
      input.retire ?? null,
    ],
  );
  return getGamePoolEntrance(id);
}

export async function openGamePoolRun(
  entranceId: string,
  input: { durationMinutes?: number } = {},
) {
  const runId = opaqueId("gpr");
  await transaction(async (client) => {
    const entrance = await client.query<{
      preset: GamePoolPreset;
      target_size: number;
      allow_room_choice: boolean;
      allow_new_rooms: boolean;
      name_visibility: string;
      retired_at: Date | null;
    }>("select * from game_pool_entrances where id = $1 for update", [entranceId]);
    const row = entrance.rows[0];
    if (!row || row.retired_at) throw new Error("Game entrance is unavailable");
    await client.query(
      `update game_pool_runs
       set status = 'closed', closed_at = now(), updated_at = now()
       where entrance_id = $1 and status in ('open', 'paused')`,
      [entranceId],
    );
    const duration = input.durationMinutes;
    const closesAt =
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
        ? new Date(Date.now() + Math.max(15, Math.min(duration, 24 * 60)) * 60_000)
        : null;
    await client.query(
      `insert into game_pool_runs (
        id, entrance_id, preset, target_size, allow_room_choice,
        allow_new_rooms, name_visibility, closes_at
      ) values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8)`,
      [
        runId,
        entranceId,
        JSON.stringify(row.preset),
        row.target_size,
        row.allow_room_choice,
        row.allow_new_rooms,
        row.name_visibility,
        closesAt,
      ],
    );
  });
  return getGamePoolEntrance(entranceId);
}

export async function setGamePoolRunStatus(
  entranceId: string,
  status: "open" | "paused" | "closed",
) {
  await query(
    `update game_pool_runs set
       status = $2,
       closed_at = case when $2 = 'closed' then now() else null end,
       updated_at = now()
     where entrance_id = $1 and status in ('open', 'paused')`,
    [entranceId, status],
  );
  return getGamePoolEntrance(entranceId);
}

export interface GamePoolRoomRow {
  run_id: string;
  room_id: string;
  status: "open" | "started" | "closed";
  player_count: number;
  capacity: number;
  created_at: Date;
  updated_at: Date;
}

export async function listGamePoolRoomRows(runId: string) {
  return query<GamePoolRoomRow>(
    `select * from game_pool_rooms where run_id = $1 order by created_at`,
    [runId],
  );
}

export function withGamePoolAllocation<T>(runId: string, use: (client: PoolClient) => Promise<T>) {
  return transaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`game-pool:${runId}`]);
    return use(client);
  });
}

export function createGamePoolAssignmentId() {
  return opaqueId("gpa");
}
