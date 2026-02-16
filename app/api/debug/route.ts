import { NextRequest, NextResponse } from 'next/server';
import { getSecurityWarnings, requireAuth } from '@/lib/auth';
import { getRedis } from '@/lib/redis';

/**
 * Debug endpoint — system health/status snapshot.
 * Protected behind admin auth.
 */
export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;

  // Check both naming conventions (Vercel KV vs direct Upstash)
  const hasKvUrl = !!process.env.KV_REST_API_URL;
  const hasKvToken = !!process.env.KV_REST_API_TOKEN;
  const hasUpstashUrl = !!process.env.UPSTASH_REDIS_REST_URL;
  const hasUpstashToken = !!process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasRedisUrl = hasKvUrl || hasUpstashUrl;
  const hasRedisToken = hasKvToken || hasUpstashToken;
  
  const redisConfigured = hasRedisUrl && hasRedisToken;
  const redisSource = hasKvUrl ? 'KV_REST_API_*' : hasUpstashUrl ? 'UPSTASH_REDIS_*' : 'none';

  // Lightweight reachability check (read-only).
  let redisReachable: boolean | null = null;
  let redisLatencyMs: number | null = null;
  let redisError: string | null = null;
  
  const redis = getRedis();
  if (!redisConfigured || !redis) {
    redisReachable = null;
  } else {
    const start = Date.now();
    try {
      // Any successful command implies credentials and network are good enough.
      await redis.get("mah:debug:ping");
      redisReachable = true;
      redisLatencyMs = Date.now() - start;
    } catch (error) {
      redisReachable = false;
      redisLatencyMs = Date.now() - start;
      redisError = error instanceof Error ? error.message : String(error);
    }
  }
  
  const hasCronSecret = !!process.env.CRON_SECRET;
  const securityWarnings = getSecurityWarnings();

  const r2PublicUrlConfigured = !!process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
  const r2WriteConfigured =
    !!process.env.R2_ACCOUNT_ID &&
    !!process.env.R2_ACCESS_KEY &&
    !!process.env.R2_SECRET_KEY &&
    !!process.env.R2_BUCKET;

  const authSecretConfigured = !!process.env.AUTH_SECRET;
  const staffPinConfigured = !!process.env.STAFF_PIN;
  const adminPasswordConfigured = !!process.env.ADMIN_PASSWORD;
  const uploadPinConfigured = !!process.env.UPLOAD_PIN;

  const nodeEnv = process.env.NODE_ENV ?? "unknown";
  const vercelEnv = process.env.VERCEL_ENV ?? null;
  const vercelRegion = process.env.VERCEL_REGION ?? null;
  const vercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      hasRedisUrl,
      hasRedisToken,
      redisConfigured,
      redisReachable,
      redisLatencyMs,
      redisError,
      source: redisSource,
      cronSecretConfigured: hasCronSecret,
      cronWarning: !hasCronSecret ? 'CRON_SECRET not set — cron jobs will return 503. Add it in Vercel env vars.' : null,
      r2PublicUrlConfigured,
      r2WriteConfigured,
      authSecretConfigured,
      staffPinConfigured,
      adminPasswordConfigured,
      uploadPinConfigured,
      nodeEnv,
      vercelEnv,
      vercelRegion,
      vercelCommitSha,
      securityWarnings,
    },
    help: {
      forceReload: 'DELETE /api/admin/guests/bootstrap to clear and reload from CSV',
      bootstrap: 'POST /api/admin/guests/bootstrap to load from CSV if empty',
    }
  });
}
