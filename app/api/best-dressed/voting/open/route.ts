import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { apiErrorFromRequest } from "@/lib/api-error";

const OPEN_UNTIL_KEY = "best-dressed:open-until";
const MAX_MINUTES = 120;

/**
 * GET /api/best-dressed/voting/open
 *
 * Read current voting window state (door staff UI).
 * Requires staff auth (admin JWT also works as staff).
 *
 * Returns: { success: true, isOpen, openUntil, secondsRemaining }
 */
export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "staff");
  if (authErr) return authErr;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis not configured (voting window unavailable)" },
      { status: 503 }
    );
  }

  try {
    const value = await redis.get<number | string>(OPEN_UNTIL_KEY);
    const openUntil =
      typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : 0;
    const now = Math.floor(Date.now() / 1000);
    const normalized = Number.isFinite(openUntil) ? Math.max(0, Math.floor(openUntil)) : 0;

    if (normalized > 0 && normalized <= now) {
      // Defensive cleanup if the key is stale.
      await redis.del(OPEN_UNTIL_KEY);
    }

    const effective = normalized > now ? normalized : 0;
    const secondsRemaining = effective > 0 ? Math.max(0, effective - now) : 0;

    return NextResponse.json({
      success: true,
      isOpen: effective > 0,
      openUntil: effective || null,
      secondsRemaining,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.voting.open.get",
      "Failed to read voting window",
      error
    );
  }
}

/**
 * POST /api/best-dressed/voting/open
 *
 * Temporarily open voting without codes for N minutes (door staff convenience).
 * Requires staff auth (admin JWT also works as staff).
 *
 * Body: { minutes: number }  (0 closes immediately)
 * Returns: { success: true, isOpen, openUntil, minutes, secondsRemaining }
 */
export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "staff");
  if (authErr) return authErr;

  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "Redis not configured (voting window unavailable)" },
      { status: 503 }
    );
  }

  let body: { minutes?: number } = {};
  try {
    body = (await request.json()) as { minutes?: number };
  } catch {
    body = {};
  }

  const minutesRaw = body.minutes;
  const minutes =
    typeof minutesRaw === "number" && Number.isFinite(minutesRaw)
      ? Math.max(0, Math.min(MAX_MINUTES, Math.floor(minutesRaw)))
      : 0;

  const now = Math.floor(Date.now() / 1000);
  const openUntil = minutes > 0 ? now + minutes * 60 : 0;

  try {
    await redis.set(OPEN_UNTIL_KEY, openUntil);
    if (openUntil > 0) {
      // Expire shortly after the window ends, so the key doesn't hang around forever.
      await redis.expire(OPEN_UNTIL_KEY, minutes * 60 + 60);
    } else {
      await redis.del(OPEN_UNTIL_KEY);
    }

    const secondsRemaining = openUntil > 0 ? Math.max(0, openUntil - now) : 0;
    return NextResponse.json({
      success: true,
      isOpen: openUntil > 0,
      openUntil: openUntil || null,
      minutes,
      secondsRemaining,
    });
  } catch (error) {
    return apiErrorFromRequest(
      request,
      "best-dressed.voting.open",
      "Failed to set voting window",
      error
    );
  }
}

