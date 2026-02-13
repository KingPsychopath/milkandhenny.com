import { NextRequest, NextResponse } from 'next/server';

/**
 * Verify staff PIN for guestlist page access. Keeps the PIN out of the client
 * bundle (safe for public repos). Set STAFF_PIN in Vercel and .env.local.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STAFF_PIN;
  if (!secret) {
    return NextResponse.json(
      { error: 'Staff PIN not configured' },
      { status: 503 }
    );
  }

  let body: { pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const pin = typeof body?.pin === 'string' ? body.pin.replace(/\D/g, '') : '';
  if (pin === secret) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
}
