import { getRedis } from "@/lib/platform/redis.server";
import {
  createAvailableMultiplayerRoomId,
  createMemoryRoomStore,
  createMultiplayerCredential,
  hashMultiplayerCredential,
  multiplayerActionSeen,
  multiplayerCredentialsMatch,
  registerMemoryRoomSweeper,
  rememberMultiplayerAction,
  remainingMultiplayerRoomTtlSeconds,
  withMultiplayerRoomLock,
} from "@/features/things/shared/room-primitives.server";
import {
  MULTIPLAYER_PRESENCE_LEASE_SECONDS,
  multiplayerLobbyExpiresAt,
  multiplayerPresenceLeaseExpiresAt,
} from "@/features/things/shared/multiplayer";
import { publishMultiplayerRoomWake } from "@/features/things/shared/multiplayer-runtime.server";
import { readPublicPitchDeck } from "./store.server";
import type {
  PitchControllerCredentials,
  PitchPresentationController,
  PitchPresentationCredentials,
  PitchPresentationSnapshot,
} from "./types";

interface StoredController extends PitchPresentationController {
  tokenHash: string;
}

interface PresentationState {
  roomId: string;
  eventTitle: string;
  selectedDeckId?: string;
  slideIndex: number;
  revision: number;
  hostHash: string;
  controllers: StoredController[];
  processedActionIds: string[];
  expiresAt: number;
}

export type PresentationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string };

const memoryRooms = createMemoryRoomStore<PresentationState>("pitch-presentation");

registerMemoryRoomSweeper("pitch-presentation", (now) => {
  for (const [roomId, room] of memoryRooms) if (room.expiresAt <= now) memoryRooms.delete(roomId);
});

function key(roomId: string) {
  return `pitches:presentation:${roomId}`;
}

function lockKey(roomId: string) {
  return `${key(roomId)}:lock`;
}

const PRESENTATION_RENEWAL_WINDOW_MS = 5 * 60 * 1_000;

function refreshPresentationLease(state: PresentationState, now = Date.now()) {
  const remaining = state.expiresAt - now;
  if (
    remaining > PRESENTATION_RENEWAL_WINDOW_MS &&
    remaining <= MULTIPLAYER_PRESENCE_LEASE_SECONDS * 1_000
  )
    return false;
  state.expiresAt = multiplayerPresenceLeaseExpiresAt(now);
  return true;
}

function snapshot(state: PresentationState): PitchPresentationSnapshot {
  return {
    roomId: state.roomId,
    eventTitle: state.eventTitle,
    selectedDeckId: state.selectedDeckId,
    slideIndex: state.slideIndex,
    revision: state.revision,
    expiresAt: state.expiresAt,
    controllers: state.controllers.map(({ tokenHash: _, ...controller }) => controller),
  };
}

function memoryAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function readState(roomId: string): Promise<PresentationState | null> {
  const redis = getRedis();
  if (redis) {
    const state = (await redis.get<PresentationState>(key(roomId))) ?? null;
    if (state && state.expiresAt <= Date.now()) {
      await redis.del(key(roomId));
      return null;
    }
    return state;
  }
  if (!memoryAllowed()) throw new Error("Presentation rooms require Redis");
  const state = memoryRooms.get(roomId) ?? null;
  if (state && state.expiresAt <= Date.now()) {
    memoryRooms.delete(roomId);
    return null;
  }
  return state;
}

async function saveState(state: PresentationState): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.set(key(state.roomId), state, {
      ex: remainingMultiplayerRoomTtlSeconds(state.expiresAt),
    });
    return;
  }
  if (!memoryAllowed()) throw new Error("Presentation rooms require Redis");
  memoryRooms.set(state.roomId, state);
}

async function mutate<T>(
  roomId: string,
  operation: (state: PresentationState) => Promise<PresentationResult<T>>,
): Promise<PresentationResult<T>> {
  const redis = getRedis();
  const run = async () => {
    const state = await readState(roomId);
    if (!state || state.expiresAt <= Date.now()) {
      return { ok: false as const, status: 404, error: "Presentation not found" };
    }
    const result = await operation(state);
    if (result.ok) await saveState(state);
    return result;
  };
  return redis ? withMultiplayerRoomLock(redis, { roomId, lockKey: lockKey(roomId) }, run) : run();
}

export async function createPresentationRoom(eventTitle = "The Pitch Night"): Promise<{
  credentials: PitchPresentationCredentials;
  snapshot: PitchPresentationSnapshot;
}> {
  const roomId = await createAvailableMultiplayerRoomId(async (candidate) =>
    Boolean(await readState(candidate)),
  );
  const hostToken = createMultiplayerCredential();
  const now = Date.now();
  const state: PresentationState = {
    roomId,
    eventTitle: eventTitle.trim().slice(0, 120) || "The Pitch Night",
    slideIndex: 0,
    revision: 1,
    hostHash: hashMultiplayerCredential(hostToken),
    controllers: [],
    processedActionIds: [],
    expiresAt: multiplayerLobbyExpiresAt(now, 1),
  };
  await saveState(state);
  return {
    credentials: { roomId, hostToken, expiresAt: state.expiresAt },
    snapshot: snapshot(state),
  };
}

export async function joinPresentation(
  roomId: string,
  name: string,
): Promise<PresentationResult<PitchControllerCredentials>> {
  const result = await mutate(roomId, async (state) => {
    if (state.controllers.length >= 12) {
      return { ok: false, status: 409, error: "This presentation already has enough remotes" };
    }
    const controllerToken = createMultiplayerCredential();
    const controllerId = createMultiplayerCredential(12);
    const now = Date.now();
    state.controllers.push({
      id: controllerId,
      name: name.trim().slice(0, 80),
      status: "pending",
      joinedAt: now,
      lastSeenAt: now,
      tokenHash: hashMultiplayerCredential(controllerToken),
    });
    state.expiresAt = multiplayerLobbyExpiresAt(now, 1);
    state.revision += 1;
    return {
      ok: true,
      value: {
        roomId,
        controllerId,
        controllerToken,
        expiresAt: state.expiresAt,
      },
    };
  });
  if (result.ok)
    await publishMultiplayerRoomWake("pitch-presentation", roomId).catch(() => undefined);
  return result;
}

export async function readPresentation(
  roomId: string,
  input?: { hostToken: string } | { controllerId: string; controllerToken: string },
): Promise<PresentationResult<PitchPresentationSnapshot>> {
  const redis = getRedis();
  const run = async (): Promise<PresentationResult<PitchPresentationSnapshot>> => {
    const state = await readState(roomId);
    if (!state || state.expiresAt <= Date.now()) {
      return { ok: false, status: 404, error: "Presentation not found" };
    }
    if (input && "hostToken" in input) {
      if (!multiplayerCredentialsMatch(input.hostToken, state.hostHash)) {
        return { ok: false, status: 404, error: "Presentation not found" };
      }
    } else if (input) {
      const controller = state.controllers.find((item) => item.id === input.controllerId);
      if (
        !controller ||
        !multiplayerCredentialsMatch(input.controllerToken, controller.tokenHash)
      ) {
        return { ok: false, status: 404, error: "Presentation not found" };
      }
    }
    if (input && refreshPresentationLease(state)) await saveState(state);
    const value = snapshot(state);
    return {
      ok: true,
      value: input ? value : { ...value, controllers: [] },
    };
  };
  return redis ? withMultiplayerRoomLock(redis, { roomId, lockKey: lockKey(roomId) }, run) : run();
}

export async function authorizePresentationSocket(input: {
  roomId: string;
  role: "host" | "controller";
  hostToken?: string;
  controllerId?: string;
  controllerToken?: string;
}) {
  const result =
    input.role === "host" && input.hostToken
      ? await readPresentation(input.roomId, { hostToken: input.hostToken })
      : input.role === "controller" && input.controllerId && input.controllerToken
        ? await readPresentation(input.roomId, {
            controllerId: input.controllerId,
            controllerToken: input.controllerToken,
          })
        : null;
  if (!result?.ok) return null;
  return {
    roomId: input.roomId,
    role: input.role,
    ...(input.role === "controller" && input.controllerId ? { playerId: input.controllerId } : {}),
  };
}

export async function approvePresentationController(input: {
  roomId: string;
  hostToken: string;
  controllerId: string;
  approved: boolean;
}): Promise<PresentationResult<PitchPresentationSnapshot>> {
  const result = await mutate(input.roomId, async (state) => {
    if (!multiplayerCredentialsMatch(input.hostToken, state.hostHash)) {
      return { ok: false, status: 404, error: "Presentation not found" };
    }
    refreshPresentationLease(state);
    const controller = state.controllers.find((item) => item.id === input.controllerId);
    if (!controller) return { ok: false, status: 404, error: "Remote not found" };
    controller.status = input.approved ? "approved" : "revoked";
    state.revision += 1;
    return { ok: true, value: snapshot(state) };
  });
  if (result.ok)
    await publishMultiplayerRoomWake("pitch-presentation", input.roomId).catch(() => undefined);
  return result;
}

export async function controlPresentation(input: {
  roomId: string;
  credential: string;
  controllerId?: string;
  actionId: string;
  action:
    | { type: "select"; deckId: string }
    | { type: "go"; direction: -1 | 1 }
    | { type: "slide"; index: number };
}): Promise<PresentationResult<PitchPresentationSnapshot>> {
  const result = await mutate(input.roomId, async (state) => {
    const isHost = multiplayerCredentialsMatch(input.credential, state.hostHash);
    const controller = input.controllerId
      ? state.controllers.find((item) => item.id === input.controllerId)
      : undefined;
    const isController =
      controller?.status === "approved" &&
      multiplayerCredentialsMatch(input.credential, controller.tokenHash);
    if (!isHost && !isController) {
      return { ok: false, status: 403, error: "This remote has not been approved" };
    }
    refreshPresentationLease(state);
    if (multiplayerActionSeen(state.processedActionIds, input.actionId)) {
      return { ok: true, value: snapshot(state) };
    }

    if (input.action.type === "select") {
      const deck = await readPublicPitchDeck(input.action.deckId);
      if (!deck?.publishedDocument) {
        return { ok: false, status: 404, error: "Published pitch not found" };
      }
      state.selectedDeckId = deck.id;
      state.slideIndex = 0;
    } else {
      if (!state.selectedDeckId) {
        return { ok: false, status: 409, error: "Choose a pitch first" };
      }
      const deck = await readPublicPitchDeck(state.selectedDeckId);
      const count = deck?.publishedDocument?.slides.filter((slide) => !slide.deletedAt).length ?? 0;
      if (count === 0) return { ok: false, status: 409, error: "This pitch has no slides" };
      state.slideIndex =
        input.action.type === "go"
          ? Math.max(0, Math.min(count - 1, state.slideIndex + input.action.direction))
          : Math.max(0, Math.min(count - 1, input.action.index));
    }
    if (controller) controller.lastSeenAt = Date.now();
    state.processedActionIds = rememberMultiplayerAction(state.processedActionIds, input.actionId);
    state.revision += 1;
    return { ok: true, value: snapshot(state) };
  });
  if (result.ok)
    await publishMultiplayerRoomWake("pitch-presentation", input.roomId).catch(() => undefined);
  return result;
}
