import { Context, Layer } from "effect";
import { multiplayerOperation } from "../shared/multiplayer-operation.server";
import * as engine from "./draw-country-room-engine.server";

export class DrawCountryRoomService extends Context.Service<
  DrawCountryRoomService,
  {
    readonly applyAction: typeof applyAction;
    readonly authorizeSocket: typeof authorizeSocket;
    readonly createRoom: typeof createRoom;
    readonly joinRoom: typeof joinRoom;
    readonly readSnapshot: typeof readSnapshot;
  }
>()("DrawCountryRoomService") {
  static readonly layer = Layer.succeed(this, {
    applyAction,
    authorizeSocket,
    createRoom,
    joinRoom,
    readSnapshot,
  });
}

function createRoom(input: Parameters<typeof engine.createDrawCountryRoom>[0]) {
  return multiplayerOperation(
    { game: "draw-country", operation: "create_room", timeoutMs: false },
    () => engine.createDrawCountryRoom(input),
  );
}

function joinRoom(input: Parameters<typeof engine.joinDrawCountryRoom>[0]) {
  return multiplayerOperation({ game: "draw-country", operation: "join_room" }, () =>
    engine.joinDrawCountryRoom(input),
  );
}

function readSnapshot(input: Parameters<typeof engine.readDrawCountrySnapshot>[0]) {
  return multiplayerOperation(
    { game: "draw-country", operation: "read_snapshot", reconciliation: true },
    () => engine.readDrawCountrySnapshot(input),
  );
}

function applyAction(input: Parameters<typeof engine.applyDrawCountryAction>[0]) {
  return multiplayerOperation({ game: "draw-country", operation: "apply_action" }, () =>
    engine.applyDrawCountryAction(input),
  );
}

function authorizeSocket(input: Parameters<typeof engine.authorizeDrawCountrySocket>[0]) {
  return multiplayerOperation(
    { game: "draw-country", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizeDrawCountrySocket(input),
  );
}
