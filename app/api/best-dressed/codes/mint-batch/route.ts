import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { apiError } from "@/lib/api-error";
import { randomBytes } from "crypto";

const CODE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CODE_KEY_PREFIX = "best-dressed:code:";
const MAX_BATCH = 200;
const MIN_TTL_MINUTES = 15;
const MAX_TTL_MINUTES = 12 * 60; // 12 hours

function codeKey(code: string): string {
  return `${CODE_KEY_PREFIX}${code}`;
}

function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return `BD-${out}`;
}

/**
 * POST /api/best-dressed/codes/mint-batch
 *
 * Mint many one-time vote codes for printing (door staff).
 * Requires staff auth (admin JWT also works as staff).
 *
 * Body: { count: number, ttlMinutes?: number }
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

  let body: { count?: number; ttlMinutes?: number } = {};
  try {
    body = (await request.json()) as { count?: number; ttlMinutes?: number };
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

  try {
    const codes: string[] = [];
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Try more than we need to avoid collisions without looping forever.
    let attempts = 0;
    while (codes.length < count && attempts < count * 10) {
      attempts++;
      const code = generateCode();
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

    return NextResponse.json({
      success: true,
      codes,
      ttlSeconds,
      expiresAt,
    });
  } catch (error) {
    return apiError("best-dressed.codes.mint-batch", "Failed to mint vote codes", error);
  }
}

