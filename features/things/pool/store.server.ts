import { createHash, createHmac, randomBytes } from "node:crypto";
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
import { recordGamePoolAllocationContention } from "./operations.server";

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

function opaqueId(prefix: "gpe" | "gpr" | "gpa" | "gpm") {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

function publicToken() {
  return `play_${randomBytes(24).toString("base64url")}`;
}

function operatorToken(entranceId: string, actionId: string) {
  const secret = process.env.AUTH_SECRET ?? "local-game-pool-operator-secret";
  return `operate_${createHmac("sha256", secret).update(`${entranceId}:${actionId}`).digest("base64url")}`;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
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
  actionId?: string;
}) {
  const defaults = GAME_POOL_DEFAULTS[input.game];
  const targetSize = Math.max(
    2,
    Math.min(defaults.capacity, Math.floor(input.targetSize ?? defaults.targetSize)),
  );
  const id = opaqueId("gpe");
  const token = publicToken();
  if (input.actionId) {
    const existing = await queryOne<{ id: string }>(
      "select id from game_pool_entrances where create_action_id = $1",
      [input.actionId],
    );
    if (existing) return getGamePoolEntrance(existing.id);
  }
  await query(
    `insert into game_pool_entrances (
      id, token, label, game, preset, target_size,
      allow_room_choice, allow_new_rooms, name_visibility, create_action_id
    ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
    on conflict (create_action_id) where create_action_id is not null do nothing`,
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
      input.actionId ?? null,
    ],
  );
  const entrance = input.actionId
    ? await queryOne<{ id: string }>(
        "select id from game_pool_entrances where create_action_id = $1",
        [input.actionId],
      ).then((row) => (row ? getGamePoolEntrance(row.id) : null))
    : await getGamePoolEntrance(id);
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
  input: { durationMinutes?: number; actionId?: string } = {},
) {
  const runId = opaqueId("gpr");
  const openingActionId = input.actionId ?? randomBytes(16).toString("base64url");
  const rawOperatorToken = operatorToken(entranceId, openingActionId);
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
    const repeated = await client.query(
      `select id from game_pool_runs where entrance_id = $1 and opening_action_id = $2`,
      [entranceId, openingActionId],
    );
    if (repeated.rows[0]) return;
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
        allow_new_rooms, name_visibility, closes_at, operator_token_hash, opening_action_id
      ) values ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)`,
      [
        runId,
        entranceId,
        JSON.stringify(row.preset),
        row.target_size,
        row.allow_room_choice,
        row.allow_new_rooms,
        row.name_visibility,
        closesAt,
        tokenHash(rawOperatorToken),
        openingActionId,
      ],
    );
  });
  const entrance = await getGamePoolEntrance(entranceId);
  return entrance ? { ...entrance, operatorToken: rawOperatorToken } : null;
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

export async function closeGamePoolRoomForAdmin(entranceId: string, roomId: string) {
  const runId = await transaction(async (client) => {
    const run = await client.query<{ id: string }>(
      `select id from game_pool_runs
       where entrance_id = $1 and status in ('open', 'paused')
       order by opened_at desc limit 1 for update`,
      [entranceId],
    );
    const activeRunId = run.rows[0]?.id;
    if (!activeRunId) return null;
    const room = await client.query(
      `update game_pool_rooms set status = 'closed', updated_at = now()
       where run_id = $1 and room_id = $2 and status <> 'closed'`,
      [activeRunId, roomId],
    );
    if ((room.rowCount ?? 0) > 0)
      await client.query(
        `insert into game_pool_moderation_events
         (id, run_id, room_id, action_id, actor, action)
         values ($1, $2, $3, $4, 'pool_operator', 'room_closed')
         on conflict (run_id, action_id) do nothing`,
        [opaqueId("gpm"), activeRunId, roomId, `admin-close-room:${roomId}`],
      );
    return activeRunId;
  });
  return runId ? getGamePoolEntrance(entranceId) : null;
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
    const attempted = await client.query<{ acquired: boolean }>(
      "select pg_try_advisory_xact_lock(hashtext($1)) as acquired",
      [`game-pool:${runId}`],
    );
    if (!attempted.rows[0]?.acquired) {
      recordGamePoolAllocationContention();
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`game-pool:${runId}`]);
    }
    return use(client);
  });
}

export function createGamePoolAssignmentId() {
  return opaqueId("gpa");
}
