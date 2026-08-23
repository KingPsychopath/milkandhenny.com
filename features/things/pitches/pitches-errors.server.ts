import { Data } from "effect";

export class PitchesOperationError extends Data.TaggedError("PitchesOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly publicMessage?: string;
}> {
  override get message() {
    return `pitches.${this.operation} failed`;
  }
}
