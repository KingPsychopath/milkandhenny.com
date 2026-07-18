import { Context, Effect, Layer } from "effect";

import { MultiplayerTelemetry } from "../shared/multiplayer-telemetry.server";
import { multiplayerOperation } from "../shared/multiplayer-operation.server";
import * as engine from "./remote-room-engine.server";

export class RemoteRoomService extends Context.Service<
  RemoteRoomService,
  {
    readonly authorizeSocket: typeof authorizeSocket;
    readonly closeRoom: typeof closeRoom;
    readonly createRoom: typeof createRoom;
    readonly readJudge: typeof readJudge;
    readonly readPlayerSetup: typeof readPlayerSetup;
    readonly sendJudgeCommand: typeof sendJudgeCommand;
    readonly syncPlayer: typeof syncPlayer;
  }
>()("RemoteRoomService") {
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

function authorizeSocket(input: Parameters<typeof engine.authorizeRemoteSocket>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "authorize_socket", timeoutMs: 4_000 },
    () => engine.authorizeRemoteSocket(input),
  );
}

function createRoom(input: Parameters<typeof engine.createRemoteRoom>[0]) {
  return multiplayerOperation({ game: "remote", operation: "create_room", timeoutMs: false }, () =>
    engine.createRemoteRoom(input),
  );
}

function readPlayerSetup(input: Parameters<typeof engine.readRemotePlayerSetup>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "read_player_setup", reconciliation: true },
    () => engine.readRemotePlayerSetup(input),
  );
}

function syncPlayer(input: Parameters<typeof engine.syncRemotePlayer>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "sync_player", reconciliation: true },
    () => engine.syncRemotePlayer(input),
  );
}

function readJudge(input: Parameters<typeof engine.readRemoteJudge>[0]) {
  return multiplayerOperation(
    { game: "remote", operation: "read_judge", reconciliation: true },
    () => engine.readRemoteJudge(input),
  );
}

function sendJudgeCommand(input: Parameters<typeof engine.sendRemoteJudgeCommand>[0]) {
  return multiplayerOperation({ game: "remote", operation: "send_judge_command" }, () =>
    engine.sendRemoteJudgeCommand(input),
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

function closeRoom(...input: Parameters<typeof engine.closeRemoteRoom>) {
  return multiplayerOperation({ game: "remote", operation: "close_room" }, () =>
    engine.closeRemoteRoom(...input),
  );
}
