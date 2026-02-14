import { NextRequest, NextResponse } from 'next/server';
import { getGuests, setGuests } from '@/lib/guests/kv-client';
import { requireManagementAuth } from '@/lib/guests/auth';
import { Guest, GuestStatus } from '@/lib/guests/types';

function generateId(name: string): string {
  return `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`;
}

export async function POST(request: NextRequest) {
  const authError = requireManagementAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, fullName, status, plusOneOf } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const guests = await getGuests();
    const isPlusOne = !!plusOneOf;

    const newGuest: Guest = {
      id: generateId(name),
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
    console.error('Error adding guest:', error);
    return NextResponse.json({ error: 'Failed to add guest' }, { status: 500 });
  }
}
