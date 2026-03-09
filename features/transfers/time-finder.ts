import type { FileKind } from "@/features/media/file-kinds";

const TIME_FINDER_BUCKET_MINUTES = 15;
const TIME_FINDER_WINDOW_MINUTES = 15;
const TIME_FINDER_OUTLIER_DAY_THRESHOLD = 7;

type WallClockTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type TransferTimeFinderInput<T> = {
  id: string;
  item: T;
  kind: FileKind;
  takenAt?: unknown;
};

type TransferTimeFinderBucket = {
  key: string;
  param: string;
  label: string;
  count: number;
  dateKey: string;
  minuteOfDay: number;
};

type TransferTimeFinderPreparedEntry<T> = {
  id: string;
  item: T;
  kind: FileKind;
  classification: "dated" | "undated" | "outlier";
  wallClock: WallClockTime | null;
  dateKey: string | null;
  minuteOfDay: number | null;
  bucketKey: string | null;
};

type TransferTimeFinderModel<T> = {
  entries: TransferTimeFinderPreparedEntry<T>[];
  buckets: TransferTimeFinderBucket[];
  showFinder: boolean;
  modeDateKey: string | null;
};

type TransferTimeFilterCategory = "matched" | "undated" | "outlier";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function parseNumericSegment(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimeString(value: string): string {
  return value.trim().replace(/(?:[zZ]|[+-]\d{2}:?\d{2})$/, "");
}

function parseWallClockCore(value: string, withSeconds: boolean): WallClockTime | null {
  const normalized = normalizeTimeString(value);
  const expectedLength = withSeconds ? 19 : 16;
  if (normalized.length < expectedLength) return null;
  if (normalized[4] !== "-" || normalized[7] !== "-" || normalized[10] !== "T" || normalized[13] !== ":") {
    return null;
  }
  if (withSeconds && normalized[16] !== ":") return null;

  const year = parseNumericSegment(normalized.slice(0, 4));
  const month = parseNumericSegment(normalized.slice(5, 7));
  const day = parseNumericSegment(normalized.slice(8, 10));
  const hour = parseNumericSegment(normalized.slice(11, 13));
  const minute = parseNumericSegment(normalized.slice(14, 16));
  const second = withSeconds ? parseNumericSegment(normalized.slice(17, 19)) : 0;

  if (
    year === null ||
    month === null ||
    day === null ||
    hour === null ||
    minute === null ||
    second === null ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

function parseWallClockTime(value: unknown): WallClockTime | null {
  if (typeof value !== "string") return null;
  return parseWallClockCore(value, true);
}

function parseTimeFinderParam(value: unknown): { dateKey: string; minuteOfDay: number } | null {
  if (typeof value !== "string") return null;
  const parsed = parseWallClockCore(value, false);
  if (!parsed) return null;
  return {
    dateKey: getWallClockDateKey(parsed),
    minuteOfDay: getWallClockMinuteOfDay(parsed),
  };
}

function getWallClockDateKey(value: WallClockTime): string {
  return `${value.year}-${pad2(value.month)}-${pad2(value.day)}`;
}

function getWallClockMinuteOfDay(value: WallClockTime): number {
  return value.hour * 60 + value.minute;
}

function getBucketMinuteOfDay(minuteOfDay: number): number {
  return Math.floor(minuteOfDay / TIME_FINDER_BUCKET_MINUTES) * TIME_FINDER_BUCKET_MINUTES;
}

function getBucketKey(dateKey: string, minuteOfDay: number): string {
  return `${dateKey}T${formatMinuteOfDay(minuteOfDay)}`;
}

function formatMinuteOfDay(minuteOfDay: number): string {
  return `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`;
}

function isTransferTimeFinderEligible(kind: FileKind): boolean {
  return kind === "image";
}

function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = month <= 2 ? year - 1 : year;
  const era = Math.trunc((adjustedYear >= 0 ? adjustedYear : adjustedYear - 399) / 400);
  const yearOfEra = adjustedYear - era * 400;
  const monthIndex = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.trunc((153 * monthIndex + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.trunc(yearOfEra / 4) - Math.trunc(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function compareDateKeys(left: string, right: string): number {
  return left.localeCompare(right);
}

function getCalendarDayDistance(left: string, right: string): number {
  const leftParsed = parseWallClockCore(`${left}T00:00:00`, true);
  const rightParsed = parseWallClockCore(`${right}T00:00:00`, true);
  if (!leftParsed || !rightParsed) return Number.POSITIVE_INFINITY;
  return Math.abs(
    daysFromCivil(leftParsed.year, leftParsed.month, leftParsed.day) -
      daysFromCivil(rightParsed.year, rightParsed.month, rightParsed.day)
  );
}

function getModeDateKey(dateKeys: readonly string[]): string | null {
  if (dateKeys.length === 0) return null;
  const counts = new Map<string, number>();
  for (const dateKey of dateKeys) {
    counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
  }

  let bestKey: string | null = null;
  let bestCount = -1;
  for (const [dateKey, count] of counts) {
    if (
      count > bestCount ||
      (count === bestCount && bestKey !== null && compareDateKeys(dateKey, bestKey) < 0) ||
      bestKey === null
    ) {
      bestKey = dateKey;
      bestCount = count;
    }
  }

  return bestKey;
}

function buildTransferTimeFinderModel<T>(
  inputs: readonly TransferTimeFinderInput<T>[]
): TransferTimeFinderModel<T> {
  const preparedEntries: TransferTimeFinderPreparedEntry<T>[] = [];
  const datedCandidates: Array<TransferTimeFinderPreparedEntry<T> & { wallClock: WallClockTime; dateKey: string; minuteOfDay: number }> = [];

  for (const input of inputs) {
    if (!isTransferTimeFinderEligible(input.kind)) {
      preparedEntries.push({
        id: input.id,
        item: input.item,
        kind: input.kind,
        classification: "undated",
        wallClock: null,
        dateKey: null,
        minuteOfDay: null,
        bucketKey: null,
      });
      continue;
    }

    const wallClock = parseWallClockTime(input.takenAt);
    if (!wallClock) {
      preparedEntries.push({
        id: input.id,
        item: input.item,
        kind: input.kind,
        classification: "undated",
        wallClock: null,
        dateKey: null,
        minuteOfDay: null,
        bucketKey: null,
      });
      continue;
    }

    const dateKey = getWallClockDateKey(wallClock);
    const minuteOfDay = getWallClockMinuteOfDay(wallClock);
    const bucketKey = getBucketKey(dateKey, getBucketMinuteOfDay(minuteOfDay));
    const prepared = {
      id: input.id,
      item: input.item,
      kind: input.kind,
      classification: "dated" as const,
      wallClock,
      dateKey,
      minuteOfDay,
      bucketKey,
    };
    preparedEntries.push(prepared);
    datedCandidates.push(prepared);
  }

  const modeDateKey = getModeDateKey(datedCandidates.map((entry) => entry.dateKey));
  const bucketCounts = new Map<string, TransferTimeFinderBucket>();

  for (const entry of preparedEntries) {
    if (entry.classification !== "dated" || !modeDateKey || entry.dateKey === null || entry.minuteOfDay === null) {
      continue;
    }

    if (getCalendarDayDistance(entry.dateKey, modeDateKey) > TIME_FINDER_OUTLIER_DAY_THRESHOLD) {
      entry.classification = "outlier";
      entry.bucketKey = null;
      continue;
    }

    const bucketMinute = getBucketMinuteOfDay(entry.minuteOfDay);
    const key = getBucketKey(entry.dateKey, bucketMinute);
    const existing = bucketCounts.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    // Chip labels and URL params use the bucket floor, e.g. 14:15-14:29 => 14:15.
    bucketCounts.set(key, {
      key,
      param: key,
      label: formatMinuteOfDay(bucketMinute),
      count: 1,
      dateKey: entry.dateKey,
      minuteOfDay: bucketMinute,
    });
  }

  const buckets = Array.from(bucketCounts.values()).sort((left, right) =>
    compareDateKeys(left.key, right.key)
  );

  return {
    entries: preparedEntries,
    buckets,
    showFinder: buckets.length >= 2,
    modeDateKey,
  };
}

function resolveTransferTimeFinderBucket(
  value: string | null | undefined,
  buckets: readonly TransferTimeFinderBucket[]
): TransferTimeFinderBucket | null {
  const parsed = parseTimeFinderParam(value);
  if (!parsed) return null;
  const expectedKey = getBucketKey(parsed.dateKey, parsed.minuteOfDay);
  return buckets.find((bucket) => bucket.key === expectedKey) ?? null;
}

function applyTransferTimeFinderFilter<T>(
  model: TransferTimeFinderModel<T>,
  selectedBucket: TransferTimeFinderBucket | null
): {
  orderedEntries: TransferTimeFinderPreparedEntry<T>[];
  categoryById: Map<string, TransferTimeFilterCategory>;
} {
  if (!selectedBucket) {
    return {
      orderedEntries: model.entries,
      categoryById: new Map(),
    };
  }

  const matched: TransferTimeFinderPreparedEntry<T>[] = [];
  const undated: TransferTimeFinderPreparedEntry<T>[] = [];
  const outliers: TransferTimeFinderPreparedEntry<T>[] = [];

  for (const entry of model.entries) {
    if (entry.classification === "undated") {
      undated.push(entry);
      continue;
    }
    if (entry.classification === "outlier") {
      outliers.push(entry);
      continue;
    }
    if (entry.dateKey !== selectedBucket.dateKey || entry.minuteOfDay === null) {
      continue;
    }

    // Time finder windows intentionally never span midnight. A chip at 00:05
    // only matches entries on the same parsed wall-clock date, not 23:52 from
    // the previous day even though the minute-of-day values are close.
    if (Math.abs(entry.minuteOfDay - selectedBucket.minuteOfDay) <= TIME_FINDER_WINDOW_MINUTES) {
      matched.push(entry);
    }
  }

  const categoryById = new Map<string, TransferTimeFilterCategory>();
  for (const entry of matched) categoryById.set(entry.id, "matched");
  for (const entry of undated) categoryById.set(entry.id, "undated");
  for (const entry of outliers) categoryById.set(entry.id, "outlier");

  return {
    orderedEntries: [...matched, ...undated, ...outliers],
    categoryById,
  };
}

export {
  TIME_FINDER_BUCKET_MINUTES,
  TIME_FINDER_OUTLIER_DAY_THRESHOLD,
  TIME_FINDER_WINDOW_MINUTES,
  applyTransferTimeFinderFilter,
  buildTransferTimeFinderModel,
  formatMinuteOfDay,
  getBucketKey,
  getBucketMinuteOfDay,
  getCalendarDayDistance,
  getModeDateKey,
  getWallClockDateKey,
  getWallClockMinuteOfDay,
  isTransferTimeFinderEligible,
  parseTimeFinderParam,
  parseWallClockTime,
  resolveTransferTimeFinderBucket,
};

export type {
  TransferTimeFilterCategory,
  TransferTimeFinderBucket,
  TransferTimeFinderInput,
  TransferTimeFinderModel,
  TransferTimeFinderPreparedEntry,
  WallClockTime,
};
