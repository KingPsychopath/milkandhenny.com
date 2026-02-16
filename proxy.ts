import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Proxy for transfer page caching.
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
export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Request correlation id for observability. Next doesn't allow both `middleware.ts`
  // and `proxy.ts`, so we keep this logic here.
  let response: NextResponse;
  if (pathname.startsWith('/api/')) {
    const fromClient = request.headers.get('x-request-id');
    const fromVercel = request.headers.get('x-vercel-id');
    const requestId =
      (fromClient && fromClient.trim()) ||
      (fromVercel && fromVercel.trim()) ||
      crypto.randomUUID();

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-request-id', requestId);

    response = NextResponse.next({
      request: { headers: requestHeaders },
    });

    // Echo back so clients can report it.
    response.headers.set('x-request-id', requestId);
  } else {
    response = NextResponse.next();
  }

  if (pathname.startsWith('/t/')) {
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
  matcher: ['/t/:path*', '/api/:path*'],
};
