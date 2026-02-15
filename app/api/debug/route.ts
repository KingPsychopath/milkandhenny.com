import { NextRequest, NextResponse } from 'next/server';
import { getGuests } from '@/lib/guests/kv-client';
import { requireAuth } from '@/lib/auth';

/**
 * Debug endpoint — check Redis connection and data status.
 * Protected behind management auth.
 */
export async function GET(request: NextRequest) {
  const authErr = requireAuth(request, "admin");
  if (authErr) return authErr;
  // Check both naming conventions (Vercel KV vs direct Upstash)
  const hasKvUrl = !!process.env.KV_REST_API_URL;
  const hasKvToken = !!process.env.KV_REST_API_TOKEN;
  const hasUpstashUrl = !!process.env.UPSTASH_REDIS_REST_URL;
  const hasUpstashToken = !!process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasRedisUrl = hasKvUrl || hasUpstashUrl;
  const hasRedisToken = hasKvToken || hasUpstashToken;
  
  let guestCount = 0;
  let plusOneCount = 0;
  let checkedInCount = 0;
  let redisError: string | null = null;
  let sampleGuests: string[] = [];
  
  try {
    const guests = await getGuests();
    guestCount = guests.length;
    // Count +1s and checked-in guests
    guests.forEach(g => {
      if (g.checkedIn) checkedInCount++;
      if (g.plusOnes) {
        plusOneCount += g.plusOnes.length;
        g.plusOnes.forEach(p => {
          if (p.checkedIn) checkedInCount++;
        });
      }
    });
    // Show first 5 guest names as sample
    sampleGuests = guests.slice(0, 5).map(g => g.name);
  } catch (error) {
    redisError = String(error);
  }
  
  const hasCronSecret = !!process.env.CRON_SECRET;

  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      hasRedisUrl,
      hasRedisToken,
      redisConfigured: hasRedisUrl && hasRedisToken,
      source: hasKvUrl ? 'KV_REST_API_*' : hasUpstashUrl ? 'UPSTASH_REDIS_*' : 'none',
      cronSecretConfigured: hasCronSecret,
      cronWarning: !hasCronSecret ? 'CRON_SECRET not set — cron jobs will return 503. Add it in Vercel env vars.' : null,
    },
    data: {
      primaryGuests: guestCount,
      plusOnes: plusOneCount,
      totalGuests: guestCount + plusOneCount,
      checkedIn: checkedInCount,
      sampleGuests,
      error: redisError,
    },
    help: {
      forceReload: 'DELETE /api/guests/bootstrap to clear and reload from CSV',
      bootstrap: 'POST /api/guests/bootstrap to load from CSV if empty',
    }
  });
}
