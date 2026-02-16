import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getRedis } from "@/lib/platform/redis";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { generateWordsCode } from "@/features/transfers/words";

const CODE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CODE_KEY_PREFIX = "best-dressed:code:";
const CODE_INDEX_KEY = "best-dressed:code-index";
const MAX_BATCH = 200;
const MAX_ONE_WORD_BATCH = 50;
const MIN_TTL_MINUTES = 15;
const MAX_TTL_MINUTES = 12 * 60; // 12 hours
const DEFAULT_CODE_WORDS = 2 as const;

function codeKey(code: string): string {
  return `${CODE_KEY_PREFIX}${code}`;
}

function normalizeVoteCode(code: string): string {
  return code.trim().toLowerCase();
}

function parseWordCount(raw: unknown): 1 | 2 {
  if (raw === 1 || raw === 2) return raw;
  if (typeof raw === "string") {
    const n = Number.parseInt(raw, 10);
    if (n === 1 || n === 2) return n;
  }
  return DEFAULT_CODE_WORDS;
}

/**
 * POST /api/best-dressed/codes/mint-batch
 *
 * Mint many one-time vote codes for printing (door staff).
 * Requires staff auth (admin JWT also works as staff).
 *
 * Body: { count: number, ttlMinutes?: number, words?: 1 | 2 }
 * Returns: { success: true, codes: string[], ttlSeconds, expiresAt }
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "staff");
  if (authErr) return authErr;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis not configured (vote codes unavailable)" },
      { status: 503 }
    );
  }

  let body: { count?: number; ttlMinutes?: number; words?: number | string } = {};
  try {
    body = (await request.json()) as { count?: number; ttlMinutes?: number; words?: number | string };
  } catch {
    body = {};
  }

  const raw = body.count;
  const count =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.max(1, Math.min(MAX_BATCH, Math.floor(raw)))
      : 20;

  const ttlMinutesRaw = body.ttlMinutes;
  const ttlMinutes =
    typeof ttlMinutesRaw === "number" && Number.isFinite(ttlMinutesRaw)
      ? Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Math.floor(ttlMinutesRaw)))
      : Math.floor(CODE_TTL_SECONDS / 60);
  const ttlSeconds = ttlMinutes * 60;
  const words = parseWordCount(body.words);

  if (words === 1 && count > MAX_ONE_WORD_BATCH) {
    return NextResponse.json(
      {
        error: `1-word codes collide quickly in large batches. Use 2 words for sheets > ${MAX_ONE_WORD_BATCH}.`,
      },
      { status: 400 }
    );
  }

  try {
    const codes: string[] = [];
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Try more than we need to avoid collisions without looping forever.
    let attempts = 0;
    const maxAttempts = words === 1 ? count * 200 : count * 10;
    while (codes.length < count && attempts < maxAttempts) {
      attempts++;
      const code = normalizeVoteCode(generateWordsCode(words));
      const key = codeKey(code);
      const ok = await redis.set(key, 1, { nx: true });
      if (ok !== "OK") continue;
      await redis.expire(key, ttlSeconds);
      codes.push(code);
    }

    if (codes.length < count) {
      return NextResponse.json(
        { error: "Failed to mint enough codes (try again)", minted: codes.length },
        { status: 503 }
      );
    }

    // Track minted codes so staff can revoke all without scanning keys.
    const pipeline = redis.pipeline();
    for (const code of codes) pipeline.sadd(CODE_INDEX_KEY, code);
    pipeline.expire(CODE_INDEX_KEY, ttlSeconds + 60 * 60);
    await pipeline.exec();

    return NextResponse.json({
      success: true,
      codes,
      ttlSeconds,
      expiresAt,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.codes.mint-batch",
      "Failed to mint vote codes",
      error
    );
  }
}

