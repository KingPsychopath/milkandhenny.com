import { Context, Effect, Layer } from "effect";

import { multiplayerCommand, multiplayerOperation } from "../shared/multiplayer-operation.server";
import { MultiplayerTelemetry } from "../shared/multiplayer-telemetry.server";
import * as engine from "./family-feud-room-engine.server";

export class FamilyFeudRoomService extends Context.Service<
  FamilyFeudRoomService,
  {
    readonly applyBuzzerAction: typeof applyBuzzerAction;
    readonly applyControllerAction: typeof applyControllerAction;
    readonly authorizeSocket: typeof authorizeSocket;
    readonly closeRoom: typeof closeRoom;
    readonly createRoom: typeof createRoom;
    readonly pairController: typeof pairController;
    readonly readSnapshot: typeof readSnapshot;
  }
>()("FamilyFeudRoomService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const telemetry = yield* MultiplayerTelemetry;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          engine.setFamilyFeudRoomLockObserver((input) =>
            Effect.runSync(telemetry.recordLock(input)),
          );
        }),
        () => Effect.sync(() => engine.setFamilyFeudRoomLockObserver(null)),
      );
      return {
        applyBuzzerAction,
        applyControllerAction,
        authorizeSocket,
        closeRoom,
        createRoom,
        pairController,
        readSnapshot,
      };
    }),
  );
}

function authorizeSocket(input: Parameters<typeof engine.authorizeFamilyFeudSocket>[0]) {
  return multiplayerOperation(
    { game: "family-feud", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizeFamilyFeudSocket(input),
  );
}

function createRoom(input: Parameters<typeof engine.createFamilyFeudRoom>[0]) {
  return multiplayerOperation(
    { game: "family-feud", operation: "create_room", timeoutMs: false },
    () => engine.createFamilyFeudRoom(input),
  );
}

function readSnapshot(input: Parameters<typeof engine.readFamilyFeudSnapshot>[0]) {
  return multiplayerOperation(
    { game: "family-feud", operation: "read_snapshot", reconciliation: true, timeoutMs: 4_000 },
    () => engine.readFamilyFeudSnapshot(input),
  );
}

function pairController(input: Parameters<typeof engine.pairFamilyFeudController>[0]) {
  return multiplayerCommand(
    {
      game: "family-feud",
      operation: "pair_controller",
      timeoutMs: 4_000,
      wakeRoomId: input.roomId,
    },
    (_signal, context) => engine.pairFamilyFeudController(input, context),
    (result) => result.ok,
  );
}

function applyControllerAction(
  input: Parameters<typeof engine.applyFamilyFeudControllerAction>[0],
) {
  return multiplayerCommand(
    {
      game: "family-feud",
      operation: "controller_action",
      timeoutMs: 10_000,
      wakeRoomId: input.roomId,
    },
    (_signal, context) => engine.applyFamilyFeudControllerAction(input, context),
  );
}

function applyBuzzerAction(input: Parameters<typeof engine.applyFamilyFeudBuzzerAction>[0]) {
  return multiplayerCommand(
    {
      game: "family-feud",
      operation: "buzzer_action",
      timeoutMs: 4_000,
      wakeRoomId: input.roomId,
    },
    (_signal, context) => engine.applyFamilyFeudBuzzerAction(input, context),
  );
}

function closeRoom(...input: Parameters<typeof engine.closeFamilyFeudRoom>) {
  return multiplayerOperation({ game: "family-feud", operation: "close_room" }, () =>
    engine.closeFamilyFeudRoom(...input),
  );
}
