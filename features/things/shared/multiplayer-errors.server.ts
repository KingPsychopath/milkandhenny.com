import { Data } from "effect";

import type { FailureClassification } from "@/lib/platform/effect-boundary.server";
import type { MultiplayerGame } from "./multiplayer-telemetry";

export class MultiplayerOperationError extends Data.TaggedError("MultiplayerOperationError")<{
  readonly cause: unknown;
  readonly game: MultiplayerGame;
  readonly operation: string;
  readonly retryable: boolean;
  readonly classification: FailureClassification;
  readonly outcome: "known" | "uncertain";
}> {
  override get message() {
    return `${this.game}.${this.operation} failed`;
  }
}
