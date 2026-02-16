import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { apiError } from "@/lib/api-error";
import { randomBytes } from "crypto";

const CODE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CODE_KEY_PREFIX = "best-dressed:code:";
const CODE_INDEX_KEY = "best-dressed:code-index";
const MIN_TTL_MINUTES = 15;
const MAX_TTL_MINUTES = 12 * 60; // 12 hours

function codeKey(code: string): string {
  return `${CODE_KEY_PREFIX}${code}`;
}

function generateCode(): string {
  // 8 chars base32-ish, uppercase, no ambiguous chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `BD-${out}`;
}

/**
 * POST /api/best-dressed/codes/mint
 *
 * Mint a single one-time best-dressed vote code (door staff).
 * Requires staff auth (admin JWT also works as staff).
 *
 * Body (optional): { ttlMinutes?: number }
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

  let body: { ttlMinutes?: number } = {};
  try {
    body = (await request.json()) as { ttlMinutes?: number };
  } catch {
    body = {};
  }

  const ttlMinutesRaw = body.ttlMinutes;
  const ttlMinutes =
    typeof ttlMinutesRaw === "number" && Number.isFinite(ttlMinutesRaw)
      ? Math.max(MIN_TTL_MINUTES, Math.min(MAX_TTL_MINUTES, Math.floor(ttlMinutesRaw)))
      : Math.floor(CODE_TTL_SECONDS / 60);
  const ttlSeconds = ttlMinutes * 60;

  try {
    // Avoid collisions; try a few times.
    for (let i = 0; i < 5; i++) {
      const code = generateCode();
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
    return apiError("best-dressed.codes.mint", "Failed to mint vote code", error);
  }
}

