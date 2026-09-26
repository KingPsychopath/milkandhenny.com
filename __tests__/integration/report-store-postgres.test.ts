import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  appendUserReportNote,
  cleanupPostgresReports,
  listAdminReportGroups,
  ReportRateLimitError,
  submitUserReport,
  updateAdminReportGroup,
} from "@/features/reports/report-store.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => {
    throw new Error("Redis must not be used by Postgres reports");
  },
}));

describeWithDatabase("Postgres diagnostic reports", () => {
  beforeAll(async () => {
    vi.stubEnv("REPORT_STORE", "postgres");
    vi.stubEnv("AUTH_SECRET", "integration-test-reports-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query(
      "truncate diagnostic_report_receipts, diagnostic_report_rates, diagnostic_reports cascade",
    );
  });

  function request(key: string, agent = "report-postgres-test") {
    return new Request("https://milkandhenny.com/api/reports", {
      method: "POST",
      headers: { "idempotency-key": key, "user-agent": agent },
    });
  }

  function report(note?: string) {
    return {
      type: "client_error",
      payload: { surface: "report-postgres-test", errorCode: "save_error" },
      ...(note ? { userNote: note } : {}),
    };
  }

  it("commits one report and reusable receipt under concurrent submissions", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => submitUserReport(report(), request("same-report-key"))),
    );
    expect(outcomes.filter((item) => item.accepted)).toHaveLength(1);
    expect(new Set(outcomes.map((item) => item.reportId)).size).toBe(1);
    const rows = await query<{ count: string }>(
      "select count(*)::text as count from diagnostic_reports",
    );
    expect(rows[0]?.count).toBe("1");
    const receipts = await query<{ key_hash: string }>(
      "select key_hash from diagnostic_report_receipts",
    );
    expect(receipts).toHaveLength(2);
    expect(receipts.every(({ key_hash }) => /^[a-f0-9]{64}$/.test(key_hash))).toBe(true);
  });

  it("deduplicates identical details while retaining distinct explanations", async () => {
    const first = await submitUserReport(
      report("The page stopped after save."),
      request("detail-1"),
    );
    const duplicate = await submitUserReport(
      report("The page stopped after save."),
      request("detail-2"),
    );
    const distinct = await submitUserReport(
      report("The editor forgot my draft."),
      request("detail-3"),
    );
    expect(duplicate).toMatchObject({
      accepted: false,
      duplicate: true,
      reportId: first.reportId,
    });
    expect(distinct.accepted).toBe(true);
    expect((await listAdminReportGroups())[0]).toMatchObject({ count: 2, activeCount: 2 });
  });

  it("admits exactly eight concurrent reports per fingerprint and resets an expired window", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        submitUserReport(report(`Different explanation number ${index}`), request(`rate-${index}`)),
      ),
    );
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(8);
    expect(
      outcomes.filter(
        (item) => item.status === "rejected" && item.reason instanceof ReportRateLimitError,
      ),
    ).toHaveLength(4);
    const rate = await query<{ count: number; fingerprint_hash: string }>(
      "select count, fingerprint_hash from diagnostic_report_rates",
    );
    expect(rate).toHaveLength(1);
    expect(rate[0]?.count).toBe(8);
    expect(rate[0]?.fingerprint_hash).toMatch(/^[a-f0-9]{64}$/);
    await query("update diagnostic_report_rates set expires_at = now() - interval '1 second'");
    expect(
      (await submitUserReport(report("After the window expired."), request("rate-after"))).accepted,
    ).toBe(true);
  });

  it("serializes one follow-up and updates a report group with retention", async () => {
    const submitted = await submitUserReport(report(), request("follow-up-key"));
    const followUp = {
      reportId: submitted.reportId,
      followUpToken: submitted.followUpToken,
      userNote: "The save button became unresponsive.",
    };
    const outcomes = await Promise.all([
      appendUserReportNote(followUp),
      appendUserReportNote(followUp),
    ]);
    expect(outcomes.filter((item) => item.updated)).toHaveLength(1);
    expect(outcomes.filter((item) => item.duplicate)).toHaveLength(1);
    const group = (await listAdminReportGroups())[0];
    expect(group.userDetails[0]?.text).toBe(followUp.userNote);
    expect(await updateAdminReportGroup(group.id, "resolved", "Reviewed")).toBe(1);
    expect(await listAdminReportGroups()).toHaveLength(0);
    expect((await listAdminReportGroups(Date.now(), { includeResolved: true }))[0]).toMatchObject({
      status: "resolved",
    });
    const rows = await query<{ status: string; expires_at: Date }>(
      "select status, expires_at from diagnostic_reports",
    );
    expect(rows[0]?.status).toBe("resolved");
    expect(rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now());
  });

  it("hides expired reports and permits reuse of expired receipts", async () => {
    const first = await submitUserReport(report(), request("expiry-key"));
    await query(
      "update diagnostic_reports set created_at = now() - interval '30 days', expires_at = now() - interval '1 second' where id = $1",
      [first.reportId],
    );
    expect(await listAdminReportGroups()).toHaveLength(0);
    await query("update diagnostic_report_receipts set expires_at = now() - interval '1 second'");
    const second = await submitUserReport(report(), request("expiry-key"));
    expect(second.accepted).toBe(true);
    expect(second.reportId).not.toBe(first.reportId);
    const cleaned = await cleanupPostgresReports();
    expect(cleaned).toMatchObject({ reports: 1, receipts: 0 });
    const remaining = await query<{ count: string }>(
      "select count(*)::text as count from diagnostic_reports",
    );
    expect(remaining[0]?.count).toBe("1");
  });
});
