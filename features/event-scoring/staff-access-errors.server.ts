import { Data } from "effect";

import type { FailureClassification } from "@/lib/platform/effect-boundary.server";

export class StaffAccessOperationError extends Data.TaggedError("StaffAccessOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
  readonly retryable: boolean;
  readonly classification: FailureClassification;
  readonly outcome: "known" | "uncertain";
  readonly status?: number;
  readonly publicMessage?: string;
}> {
  override get message() {
    return `event-staff.${this.operation} failed`;
  }
}
