import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { countryById } from "@/features/things/draw-country/countries";
import { parseCountryDrawing } from "@/features/things/draw-country/drawing-constraints";
import { scoreCountryDrawing } from "@/features/things/draw-country/scoring";
import type { CountryScore } from "@/features/things/draw-country/types";
import { getRedis } from "@/lib/platform/redis.server";
import {
  decayedReportWeight,
  REPORT_POLICIES,
  REPORT_STATUSES,
  type ReportSeverity,
  type ReportStatus,
  type ReportType,
} from "./report-policy";
import type {
  AdminReportGroup,
  DiagnosticAction,
  DiagnosticContext,
  DiagnosticDevice,
  DiagnosticError,
  ReportContextByType,
  UserReportDraft,
  UserReportRecord,
} from "./types";

const REPORT_INDEX_KEY = "diagnostic-report:index:v1";
const REPORT_KEY_PREFIX = "diagnostic-report:v1:";
const REPORT_RATE_LIMIT_PREFIX = "diagnostic-report:rate:v1:";
const REPORT_DUPLICATE_PREFIX = "diagnostic-report:duplicate:v1:";
const REPORT_IDEMPOTENCY_PREFIX = "diagnostic-report:idempotency:v1:";
const REPORT_FOLLOW_UP_LOCK_PREFIX = "diagnostic-report:follow-up-lock:v1:";
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60;
const IDEMPOTENCY_WINDOW_SECONDS = 24 * 60 * 60;
const FOLLOW_UP_LOCK_SECONDS = 30;
const RATE_LIMIT_MAX = 8;
const MAX_ADMIN_REPORTS = 500;
const MAX_TRAIL_ITEMS = 12;
const MAX_REPORT_NOTE_LENGTH = 1_000;
const MIN_USER_NOTE_LENGTH = 3;
const MAX_USER_DETAILS_PER_GROUP = 8;
const MAX_REPORT_RETENTION_SECONDS =
  Math.max(
    ...Object.values(REPORT_POLICIES).map(
      ({ retentionDays, resolvedRetentionDays }) => retentionDays + resolvedRetentionDays,
    ),
  ) * 86_400;

const memoryReports = new Map<string, UserReportRecord>();
const memoryRateLimits = new Map<string, { count: number; resetAtMs: number }>();
const memoryReservations = new Map<string, { value: string; expiresAtMs: number }>();

export class ReportValidationError extends Error {}

export class ReportRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = RATE_LIMIT_WINDOW_SECONDS) {
    super("Too many reports");
    this.name = "ReportRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ReportFollowUpError extends Error {}

function reportKey(id: string) {
  return `${REPORT_KEY_PREFIX}${id}`;
}

function reportFollowUpToken(reportId: string) {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret && process.env.NODE_ENV === "production")
    throw new Error("Report follow-up secret unavailable");
  return createHmac("sha256", secret ?? "local-report-follow-up-secret")
    .update(`report-follow-up:v1:${reportId}`)
    .digest("base64url");
}

function tokensMatch(expected: string, received: string) {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function isReportType(value: unknown): value is ReportType {
  return typeof value === "string" && value in REPORT_POLICIES;
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

function inputRecord(value: unknown, message = "Invalid report") {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ReportValidationError(message);
  return Object.fromEntries(Object.entries(value));
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function safeKey(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

function requiredText(record: Record<string, unknown>, key: string, maxLength = 120) {
  const value = safeText(record[key], maxLength);
  if (!value) throw new ReportValidationError(`Invalid ${key}`);
  return value;
}

function optionalText(record: Record<string, unknown>, key: string, maxLength = 120) {
  return safeText(record[key], maxLength);
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new ReportValidationError(`Invalid ${key}`);
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ReportValidationError(`Invalid ${key}`);
  return value;
}

function optionalConnectionState(record: Record<string, unknown>) {
  const value = record.connectionState;
  if (value === undefined) return undefined;
  if (value !== "connected" && value !== "reconnecting" && value !== "offline")
    throw new ReportValidationError("Invalid connection state");
  return value;
}

function diagnosticAction(value: unknown): DiagnosticAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = Object.fromEntries(Object.entries(value));
  const name = safeText(record.name, 80);
  if (!name) return null;
  const at = safeText(record.at, 40) ?? new Date().toISOString();
  const rawData = record.data;
  let data: DiagnosticAction["data"];
  if (rawData && typeof rawData === "object" && !Array.isArray(rawData)) {
    data = {};
    for (const [key, rawValue] of Object.entries(rawData).slice(0, 8)) {
      if (
        typeof rawValue === "string" ||
        typeof rawValue === "number" ||
        typeof rawValue === "boolean" ||
        rawValue === null
      ) {
        data[safeKey(key)] =
          typeof rawValue === "string" ? (safeText(rawValue, 120) ?? "") : rawValue;
      }
    }
  }
  return data && Object.keys(data).length > 0 ? { at, name, data } : { at, name };
}

function diagnosticDevice(value: unknown): DiagnosticDevice {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = Object.fromEntries(Object.entries(value));
  const width =
    record.viewport && typeof record.viewport === "object" && !Array.isArray(record.viewport)
      ? Object.fromEntries(Object.entries(record.viewport))
      : undefined;
  const viewport =
    width &&
    typeof width.width === "number" &&
    Number.isFinite(width.width) &&
    typeof width.height === "number" &&
    Number.isFinite(width.height) &&
    typeof width.pixelRatio === "number" &&
    Number.isFinite(width.pixelRatio)
      ? {
          width: Math.max(0, Math.min(10_000, Math.round(width.width))),
          height: Math.max(0, Math.min(10_000, Math.round(width.height))),
          pixelRatio: Math.max(0.1, Math.min(10, Math.round(width.pixelRatio * 100) / 100)),
        }
      : undefined;
  return {
    userAgent: safeText(record.userAgent, 240),
    platform: safeText(record.platform, 80),
    viewport,
    touch: typeof record.touch === "boolean" ? record.touch : undefined,
    online: typeof record.online === "boolean" ? record.online : undefined,
    timezone: safeText(record.timezone, 80),
  };
}

function diagnosticError(value: unknown): DiagnosticError | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = Object.fromEntries(Object.entries(value));
  const error: DiagnosticError = {
    name: safeText(record.name, 100),
    code: safeText(record.code, 100),
  };
  if (process.env.NODE_ENV !== "production") {
    error.message = safeText(record.message, 500);
    error.stack = safeText(record.stack, 4_000);
  }
  return error.name || error.code || error.message || error.stack ? error : undefined;
}

function buildDiagnostics(value: unknown, request: Request): DiagnosticContext {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value))
      : {};
  const trail = Array.isArray(record.trail)
    ? record.trail
        .map(diagnosticAction)
        .filter((item): item is DiagnosticAction => item !== null)
        .slice(-MAX_TRAIL_ITEMS)
    : [];
  const route = safeText(record.route, 200);
  return {
    schemaVersion: 1,
    diagnosticId: safeText(record.diagnosticId, 100) ?? `diag_${randomUUID().replaceAll("-", "")}`,
    buildId: safeText(record.buildId, 120) ?? "unknown",
    route: route?.startsWith("/") ? route.split(/[?#]/, 1)[0] : new URL(request.url).pathname,
    device: diagnosticDevice(record.device),
    trail,
    ...(diagnosticError(record.error) ? { error: diagnosticError(record.error) } : {}),
  };
}

function noteValue(value: unknown) {
  return safeText(value, MAX_REPORT_NOTE_LENGTH);
}

function activeStatus(status: ReportStatus) {
  return status !== "resolved" && status !== "ignored" && status !== "duplicate";
}

function reportExpiryMs(
  report: Pick<UserReportRecord, "type" | "status" | "createdAt" | "updatedAt">,
) {
  const policy = REPORT_POLICIES[report.type];
  const createdAtMs = Date.parse(report.createdAt);
  if (!Number.isFinite(createdAtMs)) return Date.now() + policy.retentionDays * 86_400_000;

  const activeExpiryMs = createdAtMs + policy.retentionDays * 86_400_000;
  if (activeStatus(report.status)) return activeExpiryMs;

  const updatedAtMs = Date.parse(report.updatedAt);
  const closedAtMs = Number.isFinite(updatedAtMs) ? updatedAtMs : createdAtMs;
  const closedExpiryMs = closedAtMs + policy.resolvedRetentionDays * 86_400_000;
  const hardExpiryMs =
    createdAtMs + (policy.retentionDays + policy.resolvedRetentionDays) * 86_400_000;
  return Math.min(closedExpiryMs, hardExpiryMs);
}

function reportTtlSeconds(
  report: Pick<UserReportRecord, "type" | "status" | "createdAt" | "updatedAt">,
) {
  return Math.max(1, Math.ceil((reportExpiryMs(report) - Date.now()) / 1_000));
}

function pruneMemoryReports(nowMs = Date.now()) {
  for (const [id, report] of memoryReports) {
    if (reportExpiryMs(report) <= nowMs) memoryReports.delete(id);
  }
}

function countryScore(evaluation: ReturnType<typeof scoreCountryDrawing>): CountryScore {
  return {
    score: evaluation.score,
    deviation: evaluation.deviation,
    mismatchDeviation: evaluation.mismatchDeviation,
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

function buildDrawCountryReport(payload: unknown, diagnostics: DiagnosticContext): UserReportDraft {
  const data = inputRecord(payload);
  const countryId = requiredText(data, "countryId", 80);
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
  const context: ReportContextByType["draw_country_result_issue"] = {
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
    diagnostics,
  };
  return {
    type: "draw_country_result_issue",
    subjectKey: `country:${safeKey(country.id)}`,
    severity: "medium",
    source: "user",
    context,
  };
}

function buildClientErrorReport(payload: unknown, diagnostics: DiagnosticContext): UserReportDraft {
  const data = inputRecord(payload);
  const surface = requiredText(data, "surface");
  const operation = optionalText(data, "operation");
  const errorCode = optionalText(data, "errorCode", 100);
  const context: ReportContextByType["client_error"] = {
    schemaVersion: 1,
    surface,
    ...(operation ? { operation } : {}),
    ...(errorCode ? { errorCode } : {}),
    diagnostics,
  };
  return {
    type: "client_error",
    subjectKey: `surface:${safeKey(surface)}:error:${safeKey(errorCode ?? "unknown")}`,
    severity: "high",
    source: "user",
    context,
  };
}

function buildSiteFeedbackReport(
  payload: unknown,
  diagnostics: DiagnosticContext,
): UserReportDraft {
  const data = inputRecord(payload);
  const surface = requiredText(data, "surface");
  const context: ReportContextByType["site_feedback"] = {
    schemaVersion: 1,
    surface,
    diagnostics,
  };
  return {
    type: "site_feedback",
    subjectKey: `surface:${safeKey(surface)}`,
    severity: "low",
    source: "user",
    context,
  };
}

function buildThingsRoomReport(payload: unknown, diagnostics: DiagnosticContext): UserReportDraft {
  const data = inputRecord(payload);
  const game = requiredText(data, "game");
  const roomId = optionalText(data, "roomId", 80);
  const phase = optionalText(data, "phase", 80);
  const connectionState = optionalConnectionState(data);
  const sequence = optionalNumber(data, "sequence", 0, Number.MAX_SAFE_INTEGER);
  const revision = optionalNumber(data, "revision", 0, Number.MAX_SAFE_INTEGER);
  const issue = optionalText(data, "issue", 160);
  const context: ReportContextByType["things_room_issue"] = {
    schemaVersion: 1,
    game,
    ...(roomId ? { roomId } : {}),
    ...(phase ? { phase } : {}),
    ...(connectionState ? { connectionState } : {}),
    ...(sequence !== undefined ? { sequence } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(issue ? { issue } : {}),
    diagnostics,
  };
  return {
    type: "things_room_issue",
    subjectKey: `game:${safeKey(game)}:room:${safeKey(roomId ?? "unknown")}:issue:${safeKey(issue ?? "unknown")}`,
    severity: "medium",
    source: "user",
    context,
  };
}

function buildPitchReport(payload: unknown, diagnostics: DiagnosticContext): UserReportDraft {
  const data = inputRecord(payload);
  const surface = requiredText(data, "surface");
  const deckId = optionalText(data, "deckId", 100);
  const roomId = optionalText(data, "roomId", 80);
  const slideId = optionalText(data, "slideId", 100);
  const slideIndex = optionalNumber(data, "slideIndex", 0, 10_000);
  const operation = optionalText(data, "operation", 120);
  const status = optionalText(data, "status", 120);
  const retryable = optionalBoolean(data, "retryable");
  const context: ReportContextByType["pitch_issue"] = {
    schemaVersion: 1,
    surface,
    ...(deckId ? { deckId } : {}),
    ...(roomId ? { roomId } : {}),
    ...(slideId ? { slideId } : {}),
    ...(slideIndex !== undefined ? { slideIndex } : {}),
    ...(operation ? { operation } : {}),
    ...(status ? { status } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    diagnostics,
  };
  return {
    type: "pitch_issue",
    subjectKey: `surface:${safeKey(surface)}:deck:${safeKey(deckId ?? "unknown")}:operation:${safeKey(operation ?? "unknown")}`,
    severity: retryable === false ? "high" : "medium",
    source: "user",
    context,
  };
}

function buildUploadReport(payload: unknown, diagnostics: DiagnosticContext): UserReportDraft {
  const data = inputRecord(payload);
  const surface = requiredText(data, "surface");
  const phase = optionalText(data, "phase", 100);
  const operation = optionalText(data, "operation", 120);
  const fileCount = optionalNumber(data, "fileCount", 0, 100_000);
  const bytes = optionalNumber(data, "bytes", 0, Number.MAX_SAFE_INTEGER);
  const status = optionalNumber(data, "status", 100, 599);
  const errorCode = optionalText(data, "errorCode", 100);
  const retryable = optionalBoolean(data, "retryable");
  const context: ReportContextByType["upload_issue"] = {
    schemaVersion: 1,
    surface,
    ...(phase ? { phase } : {}),
    ...(operation ? { operation } : {}),
    ...(fileCount !== undefined ? { fileCount } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    diagnostics,
  };
  return {
    type: "upload_issue",
    subjectKey: `surface:${safeKey(surface)}:operation:${safeKey(operation ?? "unknown")}:error:${safeKey(errorCode ?? "unknown")}`,
    severity: retryable === false ? "high" : "medium",
    source: "user",
    context,
  };
}

function buildReport(value: unknown, request: Request): UserReportDraft {
  const data = inputRecord(value);
  if (!isReportType(data.type)) throw new ReportValidationError("Unknown report type");
  const diagnostics = buildDiagnostics(data.diagnostics, request);
  switch (data.type) {
    case "client_error":
      return buildClientErrorReport(data.payload, diagnostics);
    case "site_feedback":
      return buildSiteFeedbackReport(data.payload, diagnostics);
    case "draw_country_result_issue":
      return buildDrawCountryReport(data.payload, diagnostics);
    case "things_room_issue":
      return buildThingsRoomReport(data.payload, diagnostics);
    case "pitch_issue":
      return buildPitchReport(data.payload, diagnostics);
    case "upload_issue":
      return buildUploadReport(data.payload, diagnostics);
  }
}

type Reservation = { reserved: true } | { reserved: false; value?: string };

function pruneMemoryReservations(nowMs = Date.now()) {
  for (const [key, value] of memoryReservations) {
    if (value.expiresAtMs <= nowMs) memoryReservations.delete(key);
  }
}

async function reserve(key: string, ttlSeconds: number): Promise<Reservation> {
  const redis = getRedis();
  if (redis) {
    const reserved = await redis.set(key, "pending", { ex: ttlSeconds, nx: true });
    if (reserved) return { reserved: true };
    const value = await redis.get<string>(key);
    return { reserved: false, value: typeof value === "string" ? value : undefined };
  }
  if (process.env.NODE_ENV === "production") throw new Error("Report storage unavailable");
  pruneMemoryReservations();
  const current = memoryReservations.get(key);
  if (current) return { reserved: false, value: current.value };
  memoryReservations.set(key, {
    value: "pending",
    expiresAtMs: Date.now() + ttlSeconds * 1_000,
  });
  return { reserved: true };
}

async function releaseReservation(key: string) {
  const redis = getRedis();
  if (redis) await redis.del(key);
  else memoryReservations.delete(key);
}

function idempotencyHeader(request: Request) {
  const value = request.headers.get("idempotency-key")?.trim();
  if (value && /^[a-zA-Z0-9._:-]{8,120}$/.test(value)) return value;
  return `generated_${randomUUID().replaceAll("-", "")}`;
}

async function enforceSubmissionLimits(
  report: UserReportDraft,
  request: Request,
): Promise<{ duplicateKey: string | null; reportId?: string }> {
  const fingerprint = requestFingerprint(request);
  const duplicateWindowSeconds = REPORT_POLICIES[report.type].duplicateWindowHours * 60 * 60;
  const duplicateKey = `${REPORT_DUPLICATE_PREFIX}${fingerprint}:${report.type}:${report.subjectKey}`;
  const rateKey = `${REPORT_RATE_LIMIT_PREFIX}${fingerprint}`;
  const duplicate = await reserve(duplicateKey, duplicateWindowSeconds);
  if (!duplicate.reserved) {
    return {
      duplicateKey: null,
      ...(duplicate.value && duplicate.value !== "pending" ? { reportId: duplicate.value } : {}),
    };
  }

  const redis = getRedis();
  if (redis) {
    const count = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, RATE_LIMIT_WINDOW_SECONDS);
    if (count > RATE_LIMIT_MAX) {
      await releaseReservation(duplicateKey);
      const ttl = await redis.ttl(rateKey);
      throw new ReportRateLimitError(ttl > 0 ? ttl : RATE_LIMIT_WINDOW_SECONDS);
    }
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("Report storage unavailable");
    const now = Date.now();
    const current = memoryRateLimits.get(rateKey);
    const rate =
      !current || current.resetAtMs <= now
        ? { count: 0, resetAtMs: now + RATE_LIMIT_WINDOW_SECONDS * 1_000 }
        : current;
    rate.count += 1;
    memoryRateLimits.set(rateKey, rate);
    if (rate.count > RATE_LIMIT_MAX) {
      await releaseReservation(duplicateKey);
      throw new ReportRateLimitError(Math.max(1, Math.ceil((rate.resetAtMs - now) / 1_000)));
    }
  }
  return { duplicateKey };
}

async function saveReport(report: UserReportRecord, idempotencyKey: string, duplicateKey: string) {
  const redis = getRedis();
  if (redis) {
    const ttlSeconds = reportTtlSeconds(report);
    const pipeline = redis.pipeline();
    pipeline.set(reportKey(report.id), JSON.stringify(report), { ex: ttlSeconds });
    pipeline.zadd(REPORT_INDEX_KEY, {
      score: new Date(report.createdAt).getTime(),
      member: report.id,
    });
    pipeline.set(`${REPORT_IDEMPOTENCY_PREFIX}${idempotencyKey}`, report.id, {
      ex: IDEMPOTENCY_WINDOW_SECONDS,
    });
    pipeline.set(duplicateKey, report.id, {
      ex: REPORT_POLICIES[report.type].duplicateWindowHours * 60 * 60,
    });
    try {
      await pipeline.exec();
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
        const cleanup = redis.pipeline();
        for (const id of overflowIds) cleanup.del(reportKey(id));
        cleanup.zrem(REPORT_INDEX_KEY, ...overflowIds);
        await cleanup.exec();
      }
    } catch (error) {
      const cleanup = redis.pipeline();
      cleanup.del(reportKey(report.id));
      cleanup.zrem(REPORT_INDEX_KEY, report.id);
      cleanup.del(`${REPORT_IDEMPOTENCY_PREFIX}${idempotencyKey}`, duplicateKey);
      await cleanup.exec().catch(() => undefined);
      throw error;
    }
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Report storage unavailable");
  pruneMemoryReports();
  memoryReports.set(report.id, report);
  memoryReservations.set(`${REPORT_IDEMPOTENCY_PREFIX}${idempotencyKey}`, {
    value: report.id,
    expiresAtMs: Date.now() + IDEMPOTENCY_WINDOW_SECONDS * 1_000,
  });
  memoryReservations.set(duplicateKey, {
    value: report.id,
    expiresAtMs: Date.now() + REPORT_POLICIES[report.type].duplicateWindowHours * 3_600_000,
  });
}

export async function submitUserReport(value: unknown, request: Request) {
  const report = buildReport(value, request);
  const idempotencyKey = idempotencyHeader(request);
  const idempotencyRedisKey = `${REPORT_IDEMPOTENCY_PREFIX}${idempotencyKey}`;
  const idempotency = await reserve(idempotencyRedisKey, IDEMPOTENCY_WINDOW_SECONDS);
  if (!idempotency.reserved) {
    return {
      accepted: false as const,
      duplicate: true as const,
      ...(idempotency.value && idempotency.value !== "pending"
        ? { reportId: idempotency.value }
        : {}),
      ...(idempotency.value && idempotency.value !== "pending"
        ? { followUpToken: reportFollowUpToken(idempotency.value) }
        : {}),
      diagnosticId: report.context.diagnostics.diagnosticId,
    };
  }

  let duplicateKey: string | null = null;
  try {
    const limits = await enforceSubmissionLimits(report, request);
    duplicateKey = limits.duplicateKey;
    if (!duplicateKey) {
      await releaseReservation(idempotencyRedisKey);
      return {
        accepted: false as const,
        duplicate: true as const,
        ...(limits.reportId
          ? { reportId: limits.reportId, followUpToken: reportFollowUpToken(limits.reportId) }
          : {}),
        diagnosticId: report.context.diagnostics.diagnosticId,
      };
    }
    const now = new Date().toISOString();
    const record = {
      ...report,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "new" as const,
    } satisfies UserReportRecord;
    const followUpToken = reportFollowUpToken(record.id);
    await saveReport(record, idempotencyKey, duplicateKey);
    return {
      accepted: true as const,
      duplicate: false as const,
      reportId: record.id,
      followUpToken,
      diagnosticId: record.context.diagnostics.diagnosticId,
    };
  } catch (error) {
    await releaseReservation(idempotencyRedisKey).catch(() => undefined);
    if (duplicateKey) await releaseReservation(duplicateKey).catch(() => undefined);
    throw error;
  }
}

function isUserReportRecord(value: unknown): value is UserReportRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const report = Object.fromEntries(Object.entries(value));
  return (
    typeof report.id === "string" &&
    isReportType(report.type) &&
    typeof report.subjectKey === "string" &&
    typeof report.createdAt === "string" &&
    typeof report.updatedAt === "string" &&
    typeof report.status === "string" &&
    REPORT_STATUSES.includes(report.status as ReportStatus) &&
    (report.severity === "low" || report.severity === "medium" || report.severity === "high") &&
    (report.source === "user" || report.source === "automatic") &&
    !!report.context &&
    typeof report.context === "object" &&
    !Array.isArray(report.context)
  );
}

async function listReportRecords() {
  const redis = getRedis();
  if (!redis) {
    pruneMemoryReports();
    return [...memoryReports.values()];
  }
  const ids = await redis.zrange<string[]>(REPORT_INDEX_KEY, 0, MAX_ADMIN_REPORTS - 1, {
    rev: true,
  });
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
  if (staleIds.length) await redis.zrem(REPORT_INDEX_KEY, ...staleIds);
  return reports;
}

async function persistReportRecord(report: UserReportRecord) {
  const redis = getRedis();
  if (redis) {
    await redis.set(reportKey(report.id), JSON.stringify(report), {
      ex: reportTtlSeconds(report),
    });
    return;
  }
  if (process.env.NODE_ENV === "production") throw new Error("Report storage unavailable");
  pruneMemoryReports();
  memoryReports.set(report.id, report);
}

function addUserNoteToReport(
  report: UserReportRecord,
  userNote: string,
  updatedAt: string,
): UserReportRecord {
  switch (report.type) {
    case "client_error":
      return {
        ...report,
        updatedAt,
        userNoteAddedAt: updatedAt,
        context: { ...report.context, userNote },
      };
    case "site_feedback":
      return {
        ...report,
        updatedAt,
        userNoteAddedAt: updatedAt,
        context: { ...report.context, userNote },
      };
    case "draw_country_result_issue":
      return {
        ...report,
        updatedAt,
        userNoteAddedAt: updatedAt,
        context: { ...report.context, userNote },
      };
    case "things_room_issue":
      return {
        ...report,
        updatedAt,
        userNoteAddedAt: updatedAt,
        context: { ...report.context, userNote },
      };
    case "pitch_issue":
      return {
        ...report,
        updatedAt,
        userNoteAddedAt: updatedAt,
        context: { ...report.context, userNote },
      };
    case "upload_issue":
      return {
        ...report,
        updatedAt,
        userNoteAddedAt: updatedAt,
        context: { ...report.context, userNote },
      };
  }
}

export async function appendUserReportNote(value: unknown) {
  const data = inputRecord(value);
  const reportId = requiredText(data, "reportId", 100);
  const followUpToken = requiredText(data, "followUpToken", 200);
  const userNote = noteValue(data.userNote);
  if (!userNote || userNote.length < MIN_USER_NOTE_LENGTH)
    throw new ReportValidationError("Add a little more detail");
  if (!tokensMatch(reportFollowUpToken(reportId), followUpToken))
    throw new ReportFollowUpError("Report unavailable");

  const lockKey = `${REPORT_FOLLOW_UP_LOCK_PREFIX}${reportId}`;
  const lock = await reserve(lockKey, FOLLOW_UP_LOCK_SECONDS);
  if (!lock.reserved) throw new ReportFollowUpError("Report unavailable");
  try {
    const report = (await listReportRecords()).find((candidate) => candidate.id === reportId);
    if (!report || !tokensMatch(reportFollowUpToken(report.id), followUpToken))
      throw new ReportFollowUpError("Report unavailable");

    if (report.context.userNote) {
      if (report.context.userNote === userNote)
        return { updated: false as const, duplicate: true as const };
      throw new ReportFollowUpError("A detail has already been added");
    }

    const updated = addUserNoteToReport(report, userNote, new Date().toISOString());
    await persistReportRecord(updated);
    return { updated: true as const, duplicate: false as const };
  } finally {
    await releaseReservation(lockKey).catch(() => undefined);
  }
}

function groupId(report: Pick<UserReportRecord, "type" | "subjectKey">) {
  return `${report.type}:${report.subjectKey}`;
}

function highestSeverity(first: ReportSeverity, second: ReportSeverity): ReportSeverity {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[second] > rank[first] ? second : first;
}

function userDetailForReport(report: UserReportRecord) {
  return report.context.userNote
    ? [
        {
          reportId: report.id,
          addedAt: report.userNoteAddedAt ?? report.createdAt,
          text: report.context.userNote,
        },
      ]
    : [];
}

export async function listAdminReportGroups(
  nowMs = Date.now(),
  options: { includeResolved?: boolean } = {},
): Promise<AdminReportGroup[]> {
  const reports = await listReportRecords();
  const groups = new Map<string, AdminReportGroup>();
  for (const report of reports) {
    if (!options.includeResolved && !activeStatus(report.status)) continue;
    const id = groupId(report);
    const weight = activeStatus(report.status)
      ? decayedReportWeight(report.type, report.createdAt, nowMs)
      : 0;
    const existing = groups.get(id);
    if (!existing) {
      groups.set(id, {
        id,
        type: report.type,
        label: REPORT_POLICIES[report.type].label,
        subjectKey: report.subjectKey,
        status: report.status,
        severity: report.severity,
        reportIds: [report.id],
        count: 1,
        activeCount: activeStatus(report.status) ? 1 : 0,
        priority: weight,
        halfLifeDays: REPORT_POLICIES[report.type].halfLifeDays,
        firstReportedAt: report.createdAt,
        latestReportedAt: report.createdAt,
        userDetails: userDetailForReport(report),
        latestContext: report.context,
        recentReports: [
          {
            id: report.id,
            createdAt: report.createdAt,
            updatedAt: report.updatedAt,
            status: report.status,
            severity: report.severity,
            source: report.source,
            context: report.context,
          },
        ],
      });
      continue;
    }
    existing.reportIds.push(report.id);
    existing.count += 1;
    existing.activeCount += activeStatus(report.status) ? 1 : 0;
    existing.priority += weight;
    existing.severity = highestSeverity(existing.severity, report.severity);
    existing.userDetails.push(...userDetailForReport(report));
    existing.recentReports.push({
      id: report.id,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      status: report.status,
      severity: report.severity,
      source: report.source,
      context: report.context,
    });
    if (report.createdAt < existing.firstReportedAt) existing.firstReportedAt = report.createdAt;
    if (report.createdAt > existing.latestReportedAt) {
      existing.latestReportedAt = report.createdAt;
      existing.latestContext = report.context;
      existing.status = report.status;
    }
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      priority: Math.round(group.priority * 1_000) / 1_000,
      userDetails: group.userDetails
        .toSorted((first, second) => second.addedAt.localeCompare(first.addedAt))
        .slice(0, MAX_USER_DETAILS_PER_GROUP),
      recentReports: group.recentReports
        .toSorted((first, second) => second.createdAt.localeCompare(first.createdAt))
        .slice(0, 8),
    }))
    .sort(
      (first, second) =>
        second.priority - first.priority ||
        second.latestReportedAt.localeCompare(first.latestReportedAt),
    );
}

function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === "string" && REPORT_STATUSES.includes(value as ReportStatus);
}

function updateReportRecord(
  report: UserReportRecord,
  status: ReportStatus,
  updatedAt: string,
  note?: string,
): UserReportRecord {
  const nextNote = noteValue(note);
  switch (report.type) {
    case "client_error":
      return {
        ...report,
        updatedAt,
        status,
        context: { ...report.context, ...(nextNote ? { note: nextNote } : {}) },
      };
    case "site_feedback":
      return {
        ...report,
        updatedAt,
        status,
        context: { ...report.context, ...(nextNote ? { note: nextNote } : {}) },
      };
    case "draw_country_result_issue":
      return {
        ...report,
        updatedAt,
        status,
        context: { ...report.context, ...(nextNote ? { note: nextNote } : {}) },
      };
    case "things_room_issue":
      return {
        ...report,
        updatedAt,
        status,
        context: { ...report.context, ...(nextNote ? { note: nextNote } : {}) },
      };
    case "pitch_issue":
      return {
        ...report,
        updatedAt,
        status,
        context: { ...report.context, ...(nextNote ? { note: nextNote } : {}) },
      };
    case "upload_issue":
      return {
        ...report,
        updatedAt,
        status,
        context: { ...report.context, ...(nextNote ? { note: nextNote } : {}) },
      };
  }
}

export async function updateAdminReportGroup(id: string, status: ReportStatus, note?: string) {
  if (!isReportStatus(status)) throw new ReportValidationError("Invalid report status");
  const separator = id.indexOf(":");
  const type = separator > 0 ? id.slice(0, separator) : "";
  const subjectKey = separator > 0 ? id.slice(separator + 1) : "";
  if (!isReportType(type) || !subjectKey) throw new ReportValidationError("Invalid report group");
  const reports = (await listReportRecords()).filter(
    (report) => report.type === type && report.subjectKey === subjectKey,
  );
  if (!reports.length) return 0;
  const updatedAt = new Date().toISOString();
  const nextReports: UserReportRecord[] = reports.map((report) =>
    updateReportRecord(report, status, updatedAt, note),
  );
  const redis = getRedis();
  if (redis) {
    const pipeline = redis.pipeline();
    for (const report of nextReports) {
      pipeline.set(reportKey(report.id), JSON.stringify(report), { ex: reportTtlSeconds(report) });
    }
    await pipeline.exec();
  } else {
    if (process.env.NODE_ENV === "production") throw new Error("Report storage unavailable");
    pruneMemoryReports();
    for (const report of nextReports) memoryReports.set(report.id, report);
  }
  return nextReports.length;
}
