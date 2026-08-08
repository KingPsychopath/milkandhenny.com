import { Context, Layer } from "effect";
import { multiplayerOperation } from "../shared/multiplayer-operation.server";
import * as engine from "./twin-room-engine.server";

export class TwinRoomService extends Context.Service<
  TwinRoomService,
  {
    readonly applyAction: typeof applyAction;
    readonly authorizeSocket: typeof authorizeSocket;
    readonly createRoom: typeof createRoom;
    readonly joinRoom: typeof joinRoom;
    readonly readLog: typeof readLog;
    readonly readSnapshot: typeof readSnapshot;
  }
>()("TwinRoomService") {
  static readonly layer = Layer.succeed(this, {
    applyAction,
    authorizeSocket,
    createRoom,
    joinRoom,
    readLog,
    readSnapshot,
  });
}

function createRoom(input: Parameters<typeof engine.createTwinRoom>[0]) {
  return multiplayerOperation({ game: "twin", operation: "create_room", timeoutMs: false }, () =>
    engine.createTwinRoom(input),
  );
}

function joinRoom(input: Parameters<typeof engine.joinTwinRoom>[0]) {
  return multiplayerOperation({ game: "twin", operation: "join_room" }, () =>
    engine.joinTwinRoom(input),
  );
}

function readSnapshot(input: Parameters<typeof engine.readTwinSnapshot>[0]) {
  return multiplayerOperation(
    { game: "twin", operation: "read_snapshot", reconciliation: true },
    () => engine.readTwinSnapshot(input),
  );
}

function readLog(input: Parameters<typeof engine.readTwinLog>[0]) {
  return multiplayerOperation({ game: "twin", operation: "read_log" }, () =>
    engine.readTwinLog(input),
  );
}

function applyAction(input: Parameters<typeof engine.applyTwinAction>[0]) {
  return multiplayerOperation({ game: "twin", operation: "apply_action" }, () =>
    engine.applyTwinAction(input),
  );
}

function authorizeSocket(input: Parameters<typeof engine.authorizeTwinSocket>[0]) {
  return multiplayerOperation(
    { game: "twin", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizeTwinSocket(input),
  );
}
