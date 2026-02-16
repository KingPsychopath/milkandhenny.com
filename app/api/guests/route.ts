import { NextRequest, NextResponse } from 'next/server';
import { getGuests, updateGuestCheckIn } from '@/features/guests/store';
import { requireAuth } from '@/features/auth/server';
import { apiErrorFromRequest } from '@/lib/platform/api-error';

export async function GET(request: NextRequest) {
  const authErr = await requireAuth(request, "staff");
  if (authErr) return authErr;

  try {
    const guests = await getGuests();
    return NextResponse.json(guests);
  } catch (error) {
    return apiErrorFromRequest(request, 'guests.list', 'Failed to fetch guests', error);
  }
}

export async function POST(request: NextRequest) {
  const authErr = await requireAuth(request, "staff");
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
    return apiErrorFromRequest(request, 'guests.checkin', 'Failed to update check-in', error);
  }
}
