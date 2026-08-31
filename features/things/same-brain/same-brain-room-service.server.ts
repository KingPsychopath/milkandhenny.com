import { Context, Effect, Layer } from "effect";

import { multiplayerCommand, multiplayerOperation } from "../shared/multiplayer-operation.server";
import { MultiplayerTelemetry } from "../shared/multiplayer-telemetry.server";
import * as engine from "./same-brain-room-engine.server";

export class SameBrainRoomService extends Context.Service<
  SameBrainRoomService,
  {
    readonly applyHostAction: typeof applyHostAction;
    readonly applyPlayerAction: typeof applyPlayerAction;
    readonly authorizeSocket: typeof authorizeSocket;
    readonly closeRoom: typeof closeRoom;
    readonly createRoom: typeof createRoom;
    readonly joinRoom: typeof joinRoom;
    readonly readSnapshot: typeof readSnapshot;
  }
>()("SameBrainRoomService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const telemetry = yield* MultiplayerTelemetry;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          engine.setSameBrainRoomLockObserver((input) =>
            Effect.runSync(telemetry.recordLock(input)),
          );
        }),
        () => Effect.sync(() => engine.setSameBrainRoomLockObserver(null)),
      );
      return {
        applyHostAction,
        applyPlayerAction,
        authorizeSocket,
        closeRoom,
        createRoom,
        joinRoom,
        readSnapshot,
      };
    }),
  );
}

function authorizeSocket(input: Parameters<typeof engine.authorizeSameBrainSocket>[0]) {
  return multiplayerOperation(
    { game: "same-brain", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizeSameBrainSocket(input),
  );
}

function createRoom(input: Parameters<typeof engine.createSameBrainRoom>[0]) {
  return multiplayerOperation(
    { game: "same-brain", operation: "create_room", timeoutMs: false },
    () => engine.createSameBrainRoom(input),
  );
}

function joinRoom(input: Parameters<typeof engine.joinSameBrainRoom>[0]) {
  return multiplayerCommand(
    { game: "same-brain", operation: "join_room", wakeRoomId: input.roomId },
    () => engine.joinSameBrainRoom(input),
  );
}

function readSnapshot(input: Parameters<typeof engine.readSameBrainSnapshot>[0]) {
  return multiplayerOperation(
    { game: "same-brain", operation: "read_snapshot", reconciliation: true, timeoutMs: 4_000 },
    () => engine.readSameBrainSnapshot(input),
  );
}

function applyHostAction(input: Parameters<typeof engine.applySameBrainHostAction>[0]) {
  return multiplayerCommand(
    {
      game: "same-brain",
      operation: "host_action",
      timeoutMs: 15_000,
      wakeRoomId: input.roomId,
    },
    (_signal, context) => engine.applySameBrainHostAction(input, context),
  );
}

function applyPlayerAction(input: Parameters<typeof engine.applySameBrainPlayerAction>[0]) {
  return multiplayerCommand(
    {
      game: "same-brain",
      operation: "player_action",
      timeoutMs: 15_000,
      wakeRoomId: input.roomId,
    },
    (_signal, context) => engine.applySameBrainPlayerAction(input, context),
  );
}

function closeRoom(...input: Parameters<typeof engine.closeSameBrainRoom>) {
  return multiplayerOperation({ game: "same-brain", operation: "close_room" }, () =>
    engine.closeSameBrainRoom(...input),
  );
}
