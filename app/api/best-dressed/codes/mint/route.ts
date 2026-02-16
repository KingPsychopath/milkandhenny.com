import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/features/auth/server";
import { getRedis } from "@/lib/platform/redis";
import { apiErrorFromRequest } from "@/lib/platform/api-error";
import { generateWordsCode } from "@/features/transfers/words";

const CODE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CODE_KEY_PREFIX = "best-dressed:code:";
const CODE_INDEX_KEY = "best-dressed:code-index";
const MIN_TTL_MINUTES = 15;
const MAX_TTL_MINUTES = 12 * 60; // 12 hours
const DEFAULT_CODE_WORDS = 2 as const;

function codeKey(code: string): string {
  return `${CODE_KEY_PREFIX}${code}`;
}

function normalizeVoteCode(code: string): string {
  // Vote codes should be easy to type and case-insensitive.
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
 * POST /api/best-dressed/codes/mint
 *
 * Mint a single one-time best-dressed vote code (door staff).
 * Requires staff auth (admin JWT also works as staff).
 *
 * Body (optional): { ttlMinutes?: number, words?: 1 | 2 }
 * Returns: { success: true, code, ttlSeconds, expiresAt }
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

  let body: { ttlMinutes?: number; words?: number | string } = {};
  try {
    body = (await request.json()) as { ttlMinutes?: number; words?: number | string };
  } catch {
    body = {};
  }

  const ttlMinutesRaw = body.ttlMinutes;
  const ttlMinutes =
    typeof ttlMinutesRaw === "number" && Number.isFinite(ttlMinutesRaw)
      ? Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Math.floor(ttlMinutesRaw)))
      : Math.floor(CODE_TTL_SECONDS / 60);
  const ttlSeconds = ttlMinutes * 60;
  const words = parseWordCount(body.words);

  try {
    // Avoid collisions; try a few times.
    const maxAttempts = words === 1 ? 25 : 5;
    for (let i = 0; i < maxAttempts; i++) {
      const code = normalizeVoteCode(generateWordsCode(words));
      const key = codeKey(code);

      // NX so we never overwrite an existing code.
      const ok = await redis.set(key, 1, { nx: true });
      if (ok !== "OK") continue;
      await redis.expire(key, ttlSeconds);
      await redis.sadd(CODE_INDEX_KEY, code);
      // Keep the index around slightly longer than codes.
      await redis.expire(CODE_INDEX_KEY, ttlSeconds + 60 * 60);

      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      return NextResponse.json({ success: true, code, ttlSeconds, expiresAt });
    }

    return NextResponse.json({ error: "Failed to mint code (try again)" }, { status: 503 });
  } catch (error) {
    return apiErrorFromRequest(request, "best-dressed.codes.mint", "Failed to mint vote code", error);
  }
}

