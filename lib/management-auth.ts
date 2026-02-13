import { NextRequest, NextResponse } from 'next/server';

/**
 * Require X-Management-Password header to match MANAGEMENT_PASSWORD env.
 * Use for guest list management routes (add, remove, import, bootstrap DELETE).
 * Returns a NextResponse to return on failure, or null if authorized.
 */
export function requireManagementAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.MANAGEMENT_PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: 'Management password not configured' },
      { status: 503 }
    );
  }
  const token = request.headers.get('X-Management-Password') ?? '';
  if (token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
