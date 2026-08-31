import { Data } from "effect";

import type { FailureClassification } from "@/lib/platform/effect-boundary.server";

export class PitchesOperationError extends Data.TaggedError("PitchesOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
  readonly retryable: boolean;
  readonly classification: FailureClassification;
  readonly outcome: "known" | "uncertain";
  readonly status?: number;
  readonly publicMessage?: string;
}> {
  override get message() {
    return `pitches.${this.operation} failed`;
  }
}
