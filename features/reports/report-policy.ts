export const REPORT_STATUSES = [
  "new",
  "investigating",
  "resolved",
  "ignored",
  "duplicate",
] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type ReportSource = "user" | "automatic";
export type ReportSeverity = "low" | "medium" | "high";

export const REPORT_POLICIES = {
  client_error: {
    label: "unexpected error",
    halfLifeDays: 1,
    retentionDays: 14,
    resolvedRetentionDays: 30,
    duplicateWindowHours: 1,
  },
  site_feedback: {
    label: "site feedback",
    halfLifeDays: 2,
    retentionDays: 30,
    resolvedRetentionDays: 30,
    duplicateWindowHours: 12,
  },
  draw_country_result_issue: {
    label: "draw country result",
    halfLifeDays: 7,
    retentionDays: 90,
    resolvedRetentionDays: 30,
    duplicateWindowHours: 24,
  },
  things_room_issue: {
    label: "game room issue",
    halfLifeDays: 3,
    retentionDays: 30,
    resolvedRetentionDays: 30,
    duplicateWindowHours: 6,
  },
  pitch_issue: {
    label: "pitch issue",
    halfLifeDays: 3,
    retentionDays: 30,
    resolvedRetentionDays: 30,
    duplicateWindowHours: 6,
  },
  upload_issue: {
    label: "upload issue",
    halfLifeDays: 2,
    retentionDays: 30,
    resolvedRetentionDays: 30,
    duplicateWindowHours: 6,
  },
} as const;

export type ReportType = keyof typeof REPORT_POLICIES;

export function decayedReportWeight(type: ReportType, createdAt: string, nowMs = Date.now()) {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return 0;
  const ageDays = Math.max(0, nowMs - createdAtMs) / 86_400_000;
  return 2 ** (-ageDays / REPORT_POLICIES[type].halfLifeDays);
}
