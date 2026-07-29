import { Data } from "effect";

export class PitchesOperationError extends Data.TaggedError("PitchesOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
  readonly retryable: boolean;
}> {
  override get message() {
    return `pitches.${this.operation} failed`;
  }
}
