import { Context, Effect, Layer } from "effect";

import { MultiplayerTelemetry } from "../shared/multiplayer-telemetry.server";
import { multiplayerOperation } from "../shared/multiplayer-operation.server";
import * as engine from "./paired-game-room-engine.server";

export class PairedGameRoomService extends Context.Service<
  PairedGameRoomService,
  {
    readonly authorizeSocket: typeof authorizeSocket;
    readonly closeRoom: typeof closeRoom;
    readonly createRoom: typeof createRoom;
    readonly readJudge: typeof readJudge;
    readonly readPlayerSetup: typeof readPlayerSetup;
    readonly sendJudgeCommand: typeof sendJudgeCommand;
    readonly syncPlayer: typeof syncPlayer;
  }
>()("PairedGameRoomService") {
  static readonly layer = Layer.succeed(this)({
    authorizeSocket,
    closeRoom,
    createRoom,
    readJudge,
    readPlayerSetup,
    sendJudgeCommand,
    syncPlayer,
  });
}

function authorizeSocket(input: Parameters<typeof engine.authorizePairedGameSocket>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizePairedGameSocket(input),
  );
}

function createRoom(input: Parameters<typeof engine.createPairedGameRoom>[0]) {
  return multiplayerOperation({ game: "remote", operation: "create_room", timeoutMs: false }, () =>
    engine.createPairedGameRoom(input),
  );
}

function readPlayerSetup(input: Parameters<typeof engine.readPairedGamePlayerSetup>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "read_player_setup", reconciliation: true },
    () => engine.readPairedGamePlayerSetup(input),
  );
}

function syncPlayer(input: Parameters<typeof engine.syncPairedGamePlayer>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "sync_player", reconciliation: true },
    () => engine.syncPairedGamePlayer(input),
  );
}

function readJudge(input: Parameters<typeof engine.readPairedGameJudge>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "read_judge", reconciliation: true },
    () => engine.readPairedGameJudge(input),
  );
}

function sendJudgeCommand(input: Parameters<typeof engine.sendPairedGameJudgeCommand>[0]) {
  return multiplayerOperation({ game: "remote", operation: "send_judge_command" }, () =>
    engine.sendPairedGameJudgeCommand(input),
  ).pipe(
    Effect.tap((result) =>
      !result.ok && result.errorCode === "rate_limited"
        ? MultiplayerTelemetry.use((telemetry) =>
            telemetry.recordRateLimit("remote", "judge_command"),
          )
        : Effect.void,
    ),
  );
}

function closeRoom(...input: Parameters<typeof engine.closePairedGameRoom>) {
  return multiplayerOperation({ game: "remote", operation: "close_room" }, () =>
    engine.closePairedGameRoom(...input),
  );
}
