import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Middleware for transfer page caching.
 *
 * Transfer content never changes after upload, so we cache the
 * server-rendered page at Vercel's CDN edge for 60s with a 5-min
 * stale-while-revalidate window. This means:
 *
 * - First visitor hits Redis (1 KV GET)
 * - Next 60s: served from CDN edge ($0, 0 KV commands)
 * - 60s–5min: served stale while revalidating in background
 * - After 5min: fresh SSR
 *
 * After admin takedown: stale page may serve for up to 60s, but
 * R2 files are already deleted so downloads will 404. Acceptable
 * trade-off for a private sharing tool.
 *
 * Cost: $0 — CDN caching is included in Vercel Hobby.
 */
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/t/')) {
    // Cache at Vercel CDN edge (not in browser — browser always gets fresh on hard refresh)
    response.headers.set(
      'CDN-Cache-Control',
      's-maxage=60, stale-while-revalidate=300'
    );
    // Don't cache in browser (countdown timer needs fresh expiresAt on hard refresh)
    response.headers.set('Cache-Control', 'no-cache');
  }

  return response;
}

export const config = {
  matcher: ['/t/:path*'],
};
