import { NextRequest, NextResponse } from 'next/server';
import { getGuests, updateGuestCheckIn } from '@/lib/guests/kv-client';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const authErr = requireAuth(request, "staff");
  if (authErr) return authErr;

  try {
    const guests = await getGuests();
    return NextResponse.json(guests);
  } catch (error) {
    console.error('Error fetching guests:', error);
    return NextResponse.json({ error: 'Failed to fetch guests' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authErr = requireAuth(request, "staff");
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { id, checkedIn } = body;

    if (typeof id !== 'string' || typeof checkedIn !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    await updateGuestCheckIn(id, checkedIn);
    const guests = await getGuests();
    return NextResponse.json(guests);
  } catch (error) {
    console.error('Error updating guest:', error);
    return NextResponse.json({ error: 'Failed to update guest' }, { status: 500 });
  }
}
