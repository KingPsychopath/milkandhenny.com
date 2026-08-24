import { Context, Layer } from "effect";
import { multiplayerOperation } from "../shared/multiplayer-operation.server";
import * as engine from "./hot-and-cold-room-engine.server";

export class HotAndColdRoomService extends Context.Service<
  HotAndColdRoomService,
  {
    readonly createRoom: typeof createRoom;
    readonly joinRoom: typeof joinRoom;
    readonly readSnapshot: typeof readSnapshot;
    readonly applyAction: typeof applyAction;
    readonly authorizeSocket: typeof authorizeSocket;
  }
>()("HotAndColdRoomService") {
  static readonly layer = Layer.succeed(this, {
    createRoom,
    joinRoom,
    readSnapshot,
    applyAction,
    authorizeSocket,
  });
}
function createRoom(input: Parameters<typeof engine.createHotAndColdRoom>[0]) {
  return multiplayerOperation(
    { game: "hot-and-cold", operation: "create_room", timeoutMs: false },
    () => engine.createHotAndColdRoom(input),
  );
}
function joinRoom(input: Parameters<typeof engine.joinHotAndColdRoom>[0]) {
  return multiplayerOperation({ game: "hot-and-cold", operation: "join_room" }, () =>
    engine.joinHotAndColdRoom(input),
  );
}
function readSnapshot(input: Parameters<typeof engine.readHotAndColdSnapshot>[0]) {
  return multiplayerOperation(
    { game: "hot-and-cold", operation: "read_snapshot", reconciliation: true, timeoutMs: 15_000 },
    () => engine.readHotAndColdSnapshot(input),
  );
}
function applyAction(input: Parameters<typeof engine.applyHotAndColdAction>[0]) {
  return multiplayerOperation(
    { game: "hot-and-cold", operation: "player_action", timeoutMs: 15_000 },
    () => engine.applyHotAndColdAction(input),
  );
}
function authorizeSocket(input: Parameters<typeof engine.authorizeHotAndColdSocket>[0]) {
  return multiplayerOperation({ game: "hot-and-cold", operation: "authorize_socket" }, () =>
    engine.authorizeHotAndColdSocket(input),
  );
}
