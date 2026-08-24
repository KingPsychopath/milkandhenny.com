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
        payload: { countryId: "CN", mode: "solo", drawing },
      },
      request,
    );
    const groups = await listAdminReportGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
    const context = groups[0].latestContext;
    if (!("drawing" in context)) throw new Error("expected a draw-country report");
    expect(context.drawing.raw).toEqual(drawing);
    expect(context.drawing.aligned).toBeUndefined();
    expect(context.result.score).toEqual(expect.any(Number));
  });

  it("should append one optional user detail and make retries idempotent", async () => {
    const { appendUserReportNote, listAdminReportGroups, submitUserReport } =
      await import("@/features/reports/report-store.server");
    const request = new Request("https://milkandhenny.com/api/reports", {
      method: "POST",
      headers: { "user-agent": "report-follow-up-test", "idempotency-key": "follow-up-test-1" },
    });

    const submitted = await submitUserReport(
      {
        type: "site_feedback",
        payload: { surface: "report-follow-up-test" },
      },
      request,
    );

    expect(submitted.reportId).toEqual(expect.any(String));
    expect(submitted.followUpToken).toEqual(expect.any(String));

    const followUp = {
      reportId: submitted.reportId,
      followUpToken: submitted.followUpToken,
      userNote: "The page stopped after I tapped save.",
    };
    await expect(appendUserReportNote(followUp)).resolves.toEqual({
      updated: true,
      duplicate: false,
    });
    await expect(appendUserReportNote(followUp)).resolves.toEqual({
      updated: false,
      duplicate: true,
    });

    const groups = await listAdminReportGroups();
    expect(groups[0]?.latestContext).toMatchObject({ userNote: followUp.userNote });
    expect(groups[0]?.userDetails).toEqual([
      { reportId: submitted.reportId, addedAt: expect.any(String), text: followUp.userNote },
    ]);
  });
});
