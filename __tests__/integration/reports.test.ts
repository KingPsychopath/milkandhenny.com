import { beforeEach, describe, expect, it, vi } from "vitest";

describe("user reports API", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should leave same-origin enforcement to the shared request middleware", async () => {
    const submitUserReport = vi.fn().mockResolvedValue({ accepted: true, duplicate: false });
    vi.doMock("@/features/reports/report-store.server", () => ({
      ReportRateLimitError: class ReportRateLimitError extends Error {},
      ReportValidationError: class ReportValidationError extends Error {},
      submitUserReport,
    }));
    const { POST } = await import("@/src/routes/api/reports/route");
    const request = new Request("http://internal.railway/api/reports", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://milkandhenny.com",
      },
      body: JSON.stringify({ type: "draw_country_result_issue", context: {} }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      accepted: true,
      duplicate: false,
    });
    expect(submitUserReport).toHaveBeenCalledOnce();
  });
});
