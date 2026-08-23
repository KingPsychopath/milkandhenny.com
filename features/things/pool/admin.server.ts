import { GAME_POOL_DEFAULTS, isGamePoolGame } from "./presets";
import {
  closeGamePoolRoomForAdmin,
  createGamePoolEntrance,
  listGamePoolEntrances,
  openGamePoolRun,
  setGamePoolRunStatus,
  updateGamePoolEntrance,
} from "./store.server";
import type { GamePoolNameVisibility } from "./types";
import {
  publishMultiplayerRoomTermination,
  publishMultiplayerRoomWake,
} from "../shared/multiplayer-runtime.server";
import { getGamePoolPublicView } from "./pool.server";

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function nameVisibility(value: unknown): GamePoolNameVisibility | undefined {
  return value === "first-names" || value === "initials" || value === "counts" ? value : undefined;
}

export async function listGamePoolsForAdmin() {
  const entrances = await listGamePoolEntrances();
  return Promise.all(
    entrances.map(async (entrance) => ({
      ...entrance,
      rooms: entrance.run ? ((await getGamePoolPublicView(entrance.token)).rooms ?? []) : [],
    })),
  );
}

export function createGamePoolForAdmin(value: unknown) {
  const input = record(value);
  if (!isGamePoolGame(input.game)) throw new Error("Choose a supported game");
  return createGamePoolEntrance({
    game: input.game,
    label: typeof input.label === "string" ? input.label : GAME_POOL_DEFAULTS[input.game].label,
    preset: input.preset,
    targetSize: optionalInteger(input.targetSize),
    autoJoin: optionalBoolean(input.autoJoin),
    allowRoomChoice: optionalBoolean(input.allowRoomChoice),
    allowNewRooms: optionalBoolean(input.allowNewRooms),
    nameVisibility: nameVisibility(input.nameVisibility),
    actionId: typeof input.actionId === "string" ? input.actionId.slice(0, 100) : undefined,
  });
}

export function updateGamePoolForAdmin(id: string, value: unknown) {
  const input = record(value);
  return updateGamePoolEntrance(id, {
    label: typeof input.label === "string" ? input.label : undefined,
    preset: input.preset,
    targetSize: optionalInteger(input.targetSize),
    autoJoin: optionalBoolean(input.autoJoin),
    allowRoomChoice: optionalBoolean(input.allowRoomChoice),
    allowNewRooms: optionalBoolean(input.allowNewRooms),
    nameVisibility: nameVisibility(input.nameVisibility),
    rotateToken: input.rotateToken === true,
    retire: typeof input.retire === "boolean" ? input.retire : undefined,
  });
}

export async function controlGamePoolForAdmin(id: string, value: unknown) {
  const input = record(value);
  const current = (await listGamePoolEntrances()).find((entrance) => entrance.id === id) ?? null;
  let entrance;
  if (input.action === "open")
    entrance = await openGamePoolRun(id, {
      durationMinutes: optionalInteger(input.durationMinutes),
      actionId: typeof input.actionId === "string" ? input.actionId.slice(0, 100) : undefined,
    });
  else if (input.action === "pause") entrance = await setGamePoolRunStatus(id, "paused");
  else if (input.action === "resume") entrance = await setGamePoolRunStatus(id, "open");
  else if (input.action === "close") entrance = await setGamePoolRunStatus(id, "closed");
  else if (input.action === "close-room") {
    if (typeof input.roomId !== "string" || !input.roomId) throw new Error("Choose a room");
    entrance = await closeGamePoolRoomForAdmin(id, input.roomId.slice(0, 80));
  } else throw new Error("Invalid game-pool action");
  const runIds = new Set([current?.run?.id, entrance?.run?.id].filter(Boolean) as string[]);
  await Promise.all(
    [...runIds].map((runId) =>
      publishMultiplayerRoomWake("game-pool", runId).catch(() => undefined),
    ),
  );
  if (input.action === "close" && current?.run?.id)
    await publishMultiplayerRoomTermination("game-pool", current.run.id, {
      reason: "session_ended",
    }).catch(() => undefined);
  return entrance;
}
