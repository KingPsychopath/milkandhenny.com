import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

describe("user report storage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should retain replayable input and aggregate diagnostics without duplicating aligned points", async () => {
    const { listAdminReportGroups, submitUserReport } =
      await import("@/features/reports/report-store.server");
    const drawing = [
      [
        { x: 120, y: 120 },
        { x: 480, y: 90 },
        { x: 760, y: 230 },
        { x: 700, y: 560 },
        { x: 350, y: 650 },
        { x: 100, y: 430 },
      ],
    ];
    const request = new Request("https://milkandhenny.com/api/reports", {
      method: "POST",
      headers: { "user-agent": "report-storage-test" },
    });

    await submitUserReport(
      {
        type: "draw_country_result_issue",
        context: { countryId: "CN", mode: "solo", drawing },
      },
      request,
    );
    const groups = await listAdminReportGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
    expect(groups[0].latestContext.drawing.raw).toEqual(drawing);
    expect(groups[0].latestContext.drawing.aligned).toBeUndefined();
    expect(groups[0].latestContext.result.score).toEqual(expect.any(Number));
  });
});
