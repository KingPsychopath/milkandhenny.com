import { NextResponse } from 'next/server';
import { getGuests } from '@/lib/kv-client';

/**
 * Debug endpoint - check Redis connection and data status
 * Visit /api/debug to verify everything is working
 */
export async function GET() {
  const hasRedisUrl = !!process.env.UPSTASH_REDIS_REST_URL;
  const hasRedisToken = !!process.env.UPSTASH_REDIS_REST_TOKEN;
  
  let guestCount = 0;
  let redisError: string | null = null;
  let sampleGuests: string[] = [];
  
  try {
    const guests = await getGuests();
    guestCount = guests.length;
    // Show first 5 guest names as sample
    sampleGuests = guests.slice(0, 5).map(g => g.name);
  } catch (error) {
    redisError = String(error);
  }
  
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      hasRedisUrl,
      hasRedisToken,
      redisConfigured: hasRedisUrl && hasRedisToken,
    },
    data: {
      guestCount,
      sampleGuests,
      error: redisError,
    },
    help: {
      forceReload: 'DELETE /api/guests/bootstrap to clear and reload from CSV',
      bootstrap: 'POST /api/guests/bootstrap to load from CSV if empty',
    }
  });
}
