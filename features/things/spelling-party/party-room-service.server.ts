import { Context, Effect, Layer } from "effect";

import { multiplayerOperation } from "../shared/multiplayer-operation.server";
import { MultiplayerTelemetry } from "../shared/multiplayer-telemetry.server";
import * as engine from "./party-room-engine.server";

export class PartyRoomService extends Context.Service<
  PartyRoomService,
  {
    readonly applyPlayerAction: typeof applyPlayerAction;
    readonly applyPresenterAction: typeof applyPresenterAction;
    readonly authorizeSocket: typeof authorizeSocket;
    readonly closeRoom: typeof closeRoom;
    readonly createRoom: typeof createRoom;
    readonly getAudioAsset: typeof getAudioAsset;
    readonly joinRoom: typeof joinRoom;
    readonly readSnapshot: typeof readSnapshot;
  }
>()("PartyRoomService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const telemetry = yield* MultiplayerTelemetry;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          engine.setPartyRoomLockObserver((input) => Effect.runSync(telemetry.recordLock(input)));
        }),
        () => Effect.sync(() => engine.setPartyRoomLockObserver(null)),
      );
      return {
        applyPlayerAction,
        applyPresenterAction,
        authorizeSocket,
        closeRoom,
        createRoom,
        getAudioAsset,
        joinRoom,
        readSnapshot,
      };
    }),
  );
}

function authorizeSocket(input: Parameters<typeof engine.authorizePartySocket>[0]) {
  return multiplayerOperation(
    { game: "spelling-party", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizePartySocket(input),
  );
}

function createRoom(input: Parameters<typeof engine.createPartyRoom>[0]) {
  return multiplayerOperation(
    { game: "spelling-party", operation: "create_room", timeoutMs: false },
    () => engine.createPartyRoom(input),
  );
}

function joinRoom(input: Parameters<typeof engine.joinPartyRoom>[0]) {
  return multiplayerOperation({ game: "spelling-party", operation: "join_room" }, () =>
    engine.joinPartyRoom(input),
  );
}

function readSnapshot(input: Parameters<typeof engine.readPartySnapshot>[0]) {
  return multiplayerOperation(
    { game: "spelling-party", operation: "read_snapshot", reconciliation: true },
    () => engine.readPartySnapshot(input),
  );
}

function applyPresenterAction(input: Parameters<typeof engine.applyPresenterAction>[0]) {
  return multiplayerOperation({ game: "spelling-party", operation: "apply_presenter_action" }, () =>
    engine.applyPresenterAction(input),
  );
}

function applyPlayerAction(input: Parameters<typeof engine.applyPlayerAction>[0]) {
  return multiplayerOperation({ game: "spelling-party", operation: "apply_player_action" }, () =>
    engine.applyPlayerAction(input),
  );
}

function getAudioAsset(...input: Parameters<typeof engine.getPartyAudioAsset>) {
  return multiplayerOperation(
    { game: "spelling-party", operation: "get_audio_asset", timeoutMs: 4_000 },
    () => engine.getPartyAudioAsset(...input),
  );
}

function closeRoom(...input: Parameters<typeof engine.closePartyRoom>) {
  return multiplayerOperation({ game: "spelling-party", operation: "close_room" }, () =>
    engine.closePartyRoom(...input),
  );
}
