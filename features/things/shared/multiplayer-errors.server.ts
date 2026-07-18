import { Data } from "effect";

import type { MultiplayerGame } from "./multiplayer-telemetry";

export class MultiplayerOperationError extends Data.TaggedError("MultiplayerOperationError")<{
  readonly cause: unknown;
  readonly game: MultiplayerGame;
  readonly operation: string;
  readonly retryable: boolean;
}> {
  override get message() {
    return `${this.game}.${this.operation} failed`;
  }
}
