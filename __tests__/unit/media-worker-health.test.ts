import { describe, expect, it } from "vitest";

import {
  mediaWorkerErrorIsActive,
  summarizeMediaWorkerError,
} from "@/features/transfers/media-worker-health";

describe("media worker health", () => {
  it("turns Redis timeout stacks into concise recovery copy", () => {
    expect(
      summarizeMediaWorkerError(
        "Error: Command timed out\n    at Timeout.<anonymous> (ioredis.mjs:843:25)",
      ),
    ).toBe("Redis queue wait timed out; reconnecting automatically.");
  });

  it("keeps an interruption active until a newer heartbeat arrives", () => {
    const interruption = {
      lastErrorAt: "2026-09-01T05:06:29.000Z",
      lastErrorMessage: "Redis queue wait timed out; reconnecting automatically.",
    };

    expect(
      mediaWorkerErrorIsActive({
        ...interruption,
        lastHeartbeatAt: "2026-09-01T05:06:29.000Z",
      }),
    ).toBe(true);
    expect(
      mediaWorkerErrorIsActive({
        ...interruption,
        lastHeartbeatAt: "2026-09-01T05:06:30.000Z",
      }),
    ).toBe(false);
  });
});
