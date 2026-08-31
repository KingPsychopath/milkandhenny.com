import { describe, expect, it } from "vitest";

import { durableWorkBacklogAgeMs, durableWorkSnapshot } from "@/features/system/durable-work";

describe("durable work health", () => {
  it("uses one truthful vocabulary across specialized mechanisms", () => {
    expect(
      durableWorkSnapshot({
        available: true,
        pending: 3,
        processing: 2,
        failed: 1,
        oldestPendingAt: "2026-08-31T10:00:00.000Z",
      }),
    ).toEqual({
      available: true,
      pending: 3,
      processing: 2,
      failed: 1,
      oldestPendingAt: "2026-08-31T10:00:00.000Z",
    });
  });

  it("derives backlog age without changing the read-only snapshot", () => {
    const snapshot = durableWorkSnapshot({
      available: true,
      pending: 1,
      processing: 0,
      failed: 0,
      oldestPendingAt: "2026-08-31T10:00:00.000Z",
    });
    expect(durableWorkBacklogAgeMs(snapshot, Date.parse("2026-08-31T10:02:00.000Z"))).toBe(120_000);
  });
});
