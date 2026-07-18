export const REPORT_POLICIES = {
  draw_country_result_issue: {
    label: "draw country result",
    halfLifeDays: 7,
    retentionDays: 90,
    duplicateWindowHours: 24,
  },
} as const;

export type ReportType = keyof typeof REPORT_POLICIES;

export function decayedReportWeight(type: ReportType, createdAt: string, nowMs = Date.now()) {
  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return 0;
  const ageDays = Math.max(0, nowMs - createdAtMs) / 86_400_000;
  return 2 ** (-ageDays / REPORT_POLICIES[type].halfLifeDays);
}
