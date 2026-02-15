import { NextRequest, NextResponse } from 'next/server';
import { getGuests, setGuests } from '@/lib/guests/kv-client';
import { requireAuth } from '@/lib/auth';
import { Guest, GuestStatus, generateGuestId } from '@/lib/guests/types';
import { apiError } from '@/lib/api-error';

export async function POST(request: NextRequest) {
  const authErr = requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const body = await request.json();
    const { name, fullName, status, plusOneOf } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const guests = await getGuests();
    const isPlusOne = !!plusOneOf;

    const newGuest: Guest = {
      id: generateGuestId(name),
      name: name.trim(),
      fullName: fullName?.trim() || undefined,
      status: (status as GuestStatus) || 'Pending',
      isPlusOne,
      plusOneOf: plusOneOf?.trim() || undefined,
      checkedIn: false,
      plusOnes: [],
    };

    if (isPlusOne && plusOneOf) {
      const mainGuestIndex = guests.findIndex((g: Guest) => g.name === plusOneOf);
      if (mainGuestIndex !== -1) {
        guests[mainGuestIndex].plusOnes = guests[mainGuestIndex].plusOnes || [];
        guests[mainGuestIndex].plusOnes.push(newGuest);
      } else {
        return NextResponse.json({ error: 'Main guest not found' }, { status: 404 });
      }
    } else {
      guests.push(newGuest);
    }

    await setGuests(guests);
    return NextResponse.json({ success: true, guest: newGuest });
  } catch (error) {
    return apiError('guests.add', 'Failed to add guest', error);
  }
}
