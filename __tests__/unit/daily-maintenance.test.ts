import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/logger.server", () => ({
  log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { runDailyMaintenanceSteps } from "@/features/system/daily-maintenance.server";

describe("daily maintenance", () => {
  it("continues after one task fails, then fails the durable job for a retry", async () => {
    const later = vi.fn();
    await expect(
      Effect.runPromise(
        runDailyMaintenanceSteps([
          { key: "first", run: Effect.fail(new Error("temporary failure")) },
          { key: "second", run: Effect.sync(later) },
        ]),
      ),
    ).rejects.toThrow("Daily maintenance failed: first");
    expect(later).toHaveBeenCalledOnce();
  });

  it("reports completion only after every task succeeds", async () => {
    await expect(
      Effect.runPromise(
        runDailyMaintenanceSteps([
          { key: "first", run: Effect.void },
          { key: "second", run: Effect.void },
        ]),
      ),
    ).resolves.toEqual({ completed: 2 });
  });
});
