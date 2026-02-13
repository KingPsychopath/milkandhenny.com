import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify management password. Used by the guest list Manage UI to unlock
 * without hardcoding the password in the client bundle (safe for public repos).
 * Set MANAGEMENT_PASSWORD in Vercel and .env.local.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.MANAGEMENT_PASSWORD;
  if (!secret) {
    return NextResponse.json(
      { error: 'Management password not configured' },
      { status: 503 }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const password = typeof body?.password === 'string' ? body.password.trim() : '';
  if (password === secret) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
}
