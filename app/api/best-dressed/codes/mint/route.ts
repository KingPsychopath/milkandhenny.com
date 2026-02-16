import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { apiError } from "@/lib/api-error";
import { randomBytes } from "crypto";

const CODE_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const CODE_KEY_PREFIX = "best-dressed:code:";

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

  try {
    // Avoid collisions; try a few times.
    for (let i = 0; i < 5; i++) {
      const code = generateCode();
      const key = codeKey(code);

      // NX so we never overwrite an existing code.
      const ok = await redis.set(key, 1, { nx: true });
      if (ok !== "OK") continue;
      await redis.expire(key, CODE_TTL_SECONDS);

      const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();
      return NextResponse.json({ success: true, code, ttlSeconds: CODE_TTL_SECONDS, expiresAt });
    }

    return NextResponse.json({ error: "Failed to mint code (try again)" }, { status: 503 });
  } catch (error) {
    return apiError("best-dressed.codes.mint", "Failed to mint vote code", error);
  }
}

