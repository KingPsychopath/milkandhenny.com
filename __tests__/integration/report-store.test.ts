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

  it("should require and atomically store details for context-only reports", async () => {
    const { listAdminReportGroups, submitUserReport } =
      await import("@/features/reports/report-store.server");
    const request = new Request("https://milkandhenny.com/api/reports", {
      method: "POST",
      headers: { "user-agent": "required-report-detail-test" },
    });
    const report = {
      type: "things_room_issue",
      payload: { game: "hot-and-cold" },
    } as const;

    await expect(submitUserReport(report, request)).rejects.toThrow("Add a little more detail");

    const userNote = "The start button did nothing when I tapped it.";
    await expect(submitUserReport({ ...report, userNote }, request)).resolves.toMatchObject({
      accepted: true,
      duplicate: false,
    });

    const groups = await listAdminReportGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.latestContext).toMatchObject({ userNote });
    expect(groups[0]?.userDetails).toEqual([
      { reportId: expect.any(String), addedAt: expect.any(String), text: userNote },
    ]);
  });

  it("should keep distinct explanations while deduplicating the same report", async () => {
    const { listAdminReportGroups, submitUserReport } =
      await import("@/features/reports/report-store.server");
    const report = {
      type: "things_room_issue",
      payload: { game: "hot-and-cold" },
    } as const;
    const request = (idempotencyKey: string) =>
      new Request("https://milkandhenny.com/api/reports", {
        method: "POST",
        headers: {
          "user-agent": "distinct-report-detail-test",
          "idempotency-key": idempotencyKey,
        },
      });

    await expect(
      submitUserReport(
        { ...report, userNote: "The start button did nothing." },
        request("distinct-detail-1"),
      ),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(
      submitUserReport(
        { ...report, userNote: "The room code was not visible." },
        request("distinct-detail-2"),
      ),
    ).resolves.toMatchObject({ accepted: true, duplicate: false });
    await expect(
      submitUserReport(
        { ...report, userNote: "The room code was not visible." },
        request("distinct-detail-3"),
      ),
    ).resolves.toMatchObject({ accepted: false, duplicate: true });

    const groups = await listAdminReportGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, activeCount: 2 });
    expect(groups[0]?.userDetails.map(({ text }) => text).toSorted()).toEqual([
      "The room code was not visible.",
      "The start button did nothing.",
    ]);
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
        type: "client_error",
        payload: { surface: "report-follow-up-test", errorCode: "test_error" },
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
