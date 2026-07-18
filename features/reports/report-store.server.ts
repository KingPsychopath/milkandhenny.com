import { createHash, randomUUID } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { countryById } from "@/features/things/draw-country/countries";
import { parseCountryDrawing } from "@/features/things/draw-country/drawing-constraints";
import { scoreCountryDrawing } from "@/features/things/draw-country/scoring";
import type { CountryScore } from "@/features/things/draw-country/types";
import { decayedReportWeight, REPORT_POLICIES } from "./report-policy";
import type {
  AdminReportGroup,
  DrawCountryResultIssueContext,
  UserReportDraft,
  UserReportRecord,
} from "./types";

const REPORT_INDEX_KEY = "user-report:index:v2";
const LEGACY_REPORT_INDEX_KEY = "user-report:index:v1";
const REPORT_KEY_PREFIX = "user-report:v1:";
const REPORT_RATE_LIMIT_PREFIX = "user-report:rate:v1:";
const REPORT_DUPLICATE_PREFIX = "user-report:duplicate:v1:";
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const RATE_LIMIT_MAX = 8;
const MAX_ADMIN_REPORTS = 500;
const MAX_REPORT_RETENTION_SECONDS =
  Math.max(...Object.values(REPORT_POLICIES).map(({ retentionDays }) => retentionDays)) * 86_400;

const memoryReports = new Map<string, UserReportRecord>();
const memoryRateLimits = new Map<string, { count: number; resetAtMs: number }>();
const memoryDuplicates = new Map<string, number>();

export class ReportValidationError extends Error {}

export class ReportRateLimitError extends Error {}

function reportKey(id: string) {
  return `${REPORT_KEY_PREFIX}${id}`;
}

function requestFingerprint(request: Request) {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const address =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    forwarded?.at(-1) ||
    "unknown";
  const agent = request.headers.get("user-agent")?.slice(0, 200) ?? "unknown";
  return createHash("sha256").update(`${address}\n${agent}`).digest("hex").slice(0, 32);
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReportValidationError("Invalid report");
  return Object.fromEntries(Object.entries(value));
}

function countryScore(evaluation: ReturnType<typeof scoreCountryDrawing>): CountryScore {
  return {
    score: evaluation.score,
    deviation: evaluation.deviation,
    borderDeviation: evaluation.borderDeviation,
    outsideDeviation: evaluation.outsideDeviation,
    insideDeviation: evaluation.insideDeviation,
    coverageDeviation: evaluation.coverageDeviation,
    silhouetteDeviation: evaluation.silhouetteDeviation,
    strokeDeviation: evaluation.strokeDeviation,
    islandDeviation: evaluation.islandDeviation,
    accuracy: evaluation.accuracy,
  };
}

function buildDrawCountryReport(value: unknown): UserReportDraft {
  const data = inputRecord(value);
  const countryId = typeof data.countryId === "string" ? data.countryId : "";
  const country = countryById(countryId);
  if (!country) throw new ReportValidationError("Invalid country");
  if (data.mode !== "solo" && data.mode !== "multiplayer")
    throw new ReportValidationError("Invalid game mode");

  let drawing;
  try {
    drawing = parseCountryDrawing(data.drawing);
  } catch {
    throw new ReportValidationError("Invalid drawing");
  }
  const evaluation = scoreCountryDrawing(country, drawing);
  const context: DrawCountryResultIssueContext = {
    schemaVersion: 1,
    mode: data.mode,
    country: {
      id: country.id,
      name: country.name,
      aspect: country.aspect,
      ringCount: country.rings.length,
      pointCount: country.rings.reduce((total, ring) => total + ring.length, 0),
      outlineFingerprint: createHash("sha256")
        .update(JSON.stringify({ aspect: country.aspect, rings: country.rings }))
        .digest("hex")
        .slice(0, 16),
    },
    result: countryScore(evaluation),
    drawing: { raw: drawing },
  };
  return {
    type: "draw_country_result_issue",
    subjectKey: `country:${country.id}`,
    context,
  };
}

function buildReport(value: unknown): UserReportDraft {
  const data = inputRecord(value);
  if (data.type !== "draw_country_result_issue")
    throw new ReportValidationError("Unknown report type");
  return buildDrawCountryReport(data.context);
}

async function enforceSubmissionLimits(report: UserReportDraft, request: Request) {
  const fingerprint = requestFingerprint(request);
  const duplicateWindowSeconds = REPORT_POLICIES[report.type].duplicateWindowHours * 60 * 60;
  const duplicateKey = `${REPORT_DUPLICATE_PREFIX}${fingerprint}:${report.type}:${report.subjectKey}`;
  const rateKey = `${REPORT_RATE_LIMIT_PREFIX}${fingerprint}`;
  const redis = getRedis();

  if (redis) {
    const reserved = await redis.set(duplicateKey, "1", { ex: duplicateWindowSeconds, nx: true });
    if (!reserved) return null;
    const count = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, RATE_LIMIT_WINDOW_SECONDS);
    if (count > RATE_LIMIT_MAX) {
      await redis.del(duplicateKey);
      throw new ReportRateLimitError("Too many reports");
    }
    return duplicateKey;
  }

  const now = Date.now();
  const duplicateUntil = memoryDuplicates.get(duplicateKey) ?? 0;
  if (duplicateUntil > now) return null;
  const current = memoryRateLimits.get(rateKey);
  const rate =
    !current || current.resetAtMs <= now
      ? { count: 0, resetAtMs: now + RATE_LIMIT_WINDOW_SECONDS * 1_000 }
      : current;
  rate.count += 1;
  memoryRateLimits.set(rateKey, rate);
  if (rate.count > RATE_LIMIT_MAX) throw new ReportRateLimitError("Too many reports");
  memoryDuplicates.set(duplicateKey, now + duplicateWindowSeconds * 1_000);
  return duplicateKey;
}

async function releaseDuplicateReservation(key: string) {
  const redis = getRedis();
  if (redis) await redis.del(key);
  else memoryDuplicates.delete(key);
}

async function saveReport(report: UserReportRecord) {
  const redis = getRedis();
  if (redis) {
    const ttlSeconds = REPORT_POLICIES[report.type].retentionDays * 86_400;
    await Promise.all([
      redis.set(reportKey(report.id), JSON.stringify(report), { ex: ttlSeconds }),
      redis.zadd(REPORT_INDEX_KEY, {
        score: new Date(report.createdAt).getTime(),
        member: report.id,
      }),
    ]);
    await redis.zremrangebyscore(
      REPORT_INDEX_KEY,
      "-inf",
      Date.now() - MAX_REPORT_RETENTION_SECONDS * 1_000,
    );
    const indexedCount = await redis.zcard(REPORT_INDEX_KEY);
    if (indexedCount > MAX_ADMIN_REPORTS) {
      const overflowIds = await redis.zrange<string[]>(
        REPORT_INDEX_KEY,
        0,
        indexedCount - MAX_ADMIN_REPORTS - 1,
      );
      const pipeline = redis.pipeline();
      for (const id of overflowIds) pipeline.del(reportKey(id));
      pipeline.zrem(REPORT_INDEX_KEY, ...overflowIds);
      await pipeline.exec();
    }
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Report storage unavailable");
  memoryReports.set(report.id, report);
}

export async function submitUserReport(value: unknown, request: Request) {
  const report = buildReport(value);
  const duplicateReservation = await enforceSubmissionLimits(report, request);
  if (!duplicateReservation) return { accepted: false as const, duplicate: true as const };
  const record: UserReportRecord = {
    ...report,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  try {
    await saveReport(record);
  } catch (error) {
    await releaseDuplicateReservation(duplicateReservation);
    throw error;
  }
  return { accepted: true as const, duplicate: false as const };
}

function isUserReportRecord(value: unknown): value is UserReportRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = Object.fromEntries(Object.entries(value));
  return (
    typeof report.id === "string" &&
    report.type === "draw_country_result_issue" &&
    typeof report.subjectKey === "string" &&
    typeof report.createdAt === "string" &&
    !!report.context &&
    typeof report.context === "object" &&
    !Array.isArray(report.context)
  );
}

async function listReportRecords() {
  const redis = getRedis();
  if (!redis) return [...memoryReports.values()];
  const [currentIds, legacyIds, legacyTtl] = await Promise.all([
    redis.zrange<string[]>(REPORT_INDEX_KEY, 0, MAX_ADMIN_REPORTS - 1, { rev: true }),
    redis.smembers(LEGACY_REPORT_INDEX_KEY) as Promise<string[]>,
    redis.ttl(LEGACY_REPORT_INDEX_KEY),
  ]);
  if (legacyTtl === -1) await redis.expire(LEGACY_REPORT_INDEX_KEY, MAX_REPORT_RETENTION_SECONDS);
  const ids = [...new Set([...currentIds, ...legacyIds])].slice(0, MAX_ADMIN_REPORTS);
  const values = await Promise.all(
    ids.map((id) => redis.get<UserReportRecord | string>(reportKey(id))),
  );
  const staleIds: string[] = [];
  const reports: UserReportRecord[] = [];
  values.forEach((value, index) => {
    if (!value) {
      staleIds.push(ids[index]);
      return;
    }
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      if (isUserReportRecord(parsed)) reports.push(parsed);
      else staleIds.push(ids[index]);
    } catch {
      staleIds.push(ids[index]);
    }
  });
  if (staleIds.length)
    await Promise.all([
      redis.zrem(REPORT_INDEX_KEY, ...staleIds),
      redis.srem(LEGACY_REPORT_INDEX_KEY, ...staleIds),
    ]);
  return reports;
}

export async function listAdminReportGroups(nowMs = Date.now()): Promise<AdminReportGroup[]> {
  const reports = await listReportRecords();
  const groups = new Map<string, AdminReportGroup>();
  for (const report of reports) {
    const id = `${report.type}:${report.subjectKey}`;
    const weight = decayedReportWeight(report.type, report.createdAt, nowMs);
    const existing = groups.get(id);
    if (!existing) {
      groups.set(id, {
        id,
        type: report.type,
        label: REPORT_POLICIES[report.type].label,
        subjectKey: report.subjectKey,
        reportIds: [report.id],
        count: 1,
        priority: weight,
        halfLifeDays: REPORT_POLICIES[report.type].halfLifeDays,
        firstReportedAt: report.createdAt,
        latestReportedAt: report.createdAt,
        latestContext: report.context,
        recentReports: [{ id: report.id, createdAt: report.createdAt, context: report.context }],
      });
      continue;
    }
    existing.reportIds.push(report.id);
    existing.count += 1;
    existing.priority += weight;
    existing.recentReports.push({
      id: report.id,
      createdAt: report.createdAt,
      context: report.context,
    });
    if (report.createdAt < existing.firstReportedAt) existing.firstReportedAt = report.createdAt;
    if (report.createdAt > existing.latestReportedAt) {
      existing.latestReportedAt = report.createdAt;
      existing.latestContext = report.context;
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      priority: Math.round(group.priority * 1_000) / 1_000,
      recentReports: group.recentReports
        .toSorted((first, second) => second.createdAt.localeCompare(first.createdAt))
        .slice(0, 5),
    }))
    .sort(
      (first, second) =>
        second.priority - first.priority ||
        second.latestReportedAt.localeCompare(first.latestReportedAt),
    );
}

export async function dismissUserReports(ids: string[]) {
  const validIds = [...new Set(ids)]
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
    .slice(0, MAX_ADMIN_REPORTS);
  if (!validIds.length) return 0;
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    for (const id of validIds) pipeline.del(reportKey(id));
    pipeline.zrem(REPORT_INDEX_KEY, ...validIds);
    pipeline.srem(LEGACY_REPORT_INDEX_KEY, ...validIds);
    await pipeline.exec();
    return validIds.length;
  }
  let dismissed = 0;
  for (const id of validIds) if (memoryReports.delete(id)) dismissed += 1;
  return dismissed;
}
