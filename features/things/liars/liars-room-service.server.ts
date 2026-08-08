import { Context, Effect, Layer } from "effect";

import { multiplayerOperation } from "../shared/multiplayer-operation.server";
import { MultiplayerTelemetry } from "../shared/multiplayer-telemetry.server";
import * as engine from "./liars-room-engine.server";

export class LiarsRoomService extends Context.Service<
  LiarsRoomService,
  {
    readonly applyHostAction: typeof applyHostAction;
    readonly applyPlayerAction: typeof applyPlayerAction;
    readonly authorizeSocket: typeof authorizeSocket;
    readonly closeRoom: typeof closeRoom;
    readonly createRoom: typeof createRoom;
    readonly joinRoom: typeof joinRoom;
    readonly readSnapshot: typeof readSnapshot;
  }
>()("LiarsRoomService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const telemetry = yield* MultiplayerTelemetry;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          engine.setLiarsRoomLockObserver((input) => Effect.runSync(telemetry.recordLock(input)));
        }),
        () => Effect.sync(() => engine.setLiarsRoomLockObserver(null)),
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

function authorizeSocket(input: Parameters<typeof engine.authorizeLiarsSocket>[0]) {
  return multiplayerOperation(
    { game: "liars", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizeLiarsSocket(input),
  );
}

function createRoom(input: Parameters<typeof engine.createLiarsRoom>[0]) {
  return multiplayerOperation({ game: "liars", operation: "create_room", timeoutMs: false }, () =>
    engine.createLiarsRoom(input),
  );
}

function joinRoom(input: Parameters<typeof engine.joinLiarsRoom>[0]) {
  return multiplayerOperation({ game: "liars", operation: "join_room" }, () =>
    engine.joinLiarsRoom(input),
  );
}

function readSnapshot(input: Parameters<typeof engine.readLiarsSnapshot>[0]) {
  return multiplayerOperation(
    { game: "liars", operation: "read_snapshot", reconciliation: true },
    () => engine.readLiarsSnapshot(input),
  );
}

function applyHostAction(input: Parameters<typeof engine.applyLiarsHostAction>[0]) {
  return multiplayerOperation({ game: "liars", operation: "apply_host_action" }, () =>
    engine.applyLiarsHostAction(input),
  );
}

function applyPlayerAction(input: Parameters<typeof engine.applyLiarsPlayerAction>[0]) {
  return multiplayerOperation({ game: "liars", operation: "apply_player_action" }, () =>
    engine.applyLiarsPlayerAction(input),
  );
}

function closeRoom(...input: Parameters<typeof engine.closeLiarsRoom>) {
  return multiplayerOperation({ game: "liars", operation: "close_room" }, () =>
    engine.closeLiarsRoom(...input),
  );
}
