import { Context, Layer } from "effect";
import { multiplayerCommand, multiplayerOperation } from "../shared/multiplayer-operation.server";
import * as engine from "./centre-room-engine.server";

export class CentreRoomService extends Context.Service<
  CentreRoomService,
  {
    readonly applyAction: typeof applyAction;
    readonly authorizeSocket: typeof authorizeSocket;
    readonly createRoom: typeof createRoom;
    readonly joinRoom: typeof joinRoom;
    readonly readReplay: typeof readReplay;
    readonly readSnapshot: typeof readSnapshot;
  }
>()("CentreRoomService") {
  static readonly layer = Layer.succeed(this, {
    applyAction,
    authorizeSocket,
    createRoom,
    joinRoom,
    readReplay,
    readSnapshot,
  });
}

function createRoom(input: Parameters<typeof engine.createCentreRoom>[0]) {
  return multiplayerOperation({ game: "centre", operation: "create_room", timeoutMs: false }, () =>
    engine.createCentreRoom(input),
  );
}

function joinRoom(input: Parameters<typeof engine.joinCentreRoom>[0]) {
  return multiplayerCommand(
    { game: "centre", operation: "join_room", wakeRoomId: input.roomId },
    () => engine.joinCentreRoom(input),
  );
}

function readSnapshot(input: Parameters<typeof engine.readCentreSnapshot>[0]) {
  return multiplayerOperation(
    { game: "centre", operation: "read_snapshot", reconciliation: true },
    () => engine.readCentreSnapshot(input),
  );
}

function readReplay(input: Parameters<typeof engine.readCentreReplay>[0]) {
  return multiplayerOperation({ game: "centre", operation: "read_replay" }, () =>
    engine.readCentreReplay(input),
  );
}

function applyAction(input: Parameters<typeof engine.applyCentreAction>[0]) {
  return multiplayerCommand(
    { game: "centre", operation: "apply_action", wakeRoomId: input.roomId },
    (_signal, context) => engine.applyCentreAction(input, context),
  );
}

function authorizeSocket(input: Parameters<typeof engine.authorizeCentreSocket>[0]) {
  return multiplayerOperation(
    { game: "centre", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizeCentreSocket(input),
  );
}
