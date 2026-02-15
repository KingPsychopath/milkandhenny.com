import { NextRequest, NextResponse } from 'next/server';
import { getGuests, setGuests } from '@/lib/guests/kv-client';
import { requireAuth } from '@/lib/auth';
import { Guest } from '@/lib/guests/types';

export async function DELETE(request: NextRequest) {
  const authErr = requireAuth(request, "admin");
  if (authErr) return authErr;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Guest ID is required' }, { status: 400 });
    }

    const guests = await getGuests();

    const removeGuestById = (guestList: Guest[]): Guest[] => {
      return guestList
        .filter((g: Guest) => g.id !== id)
        .map((g: Guest) => {
          if (g.plusOnes && g.plusOnes.length > 0) {
            return {
              ...g,
              plusOnes: g.plusOnes.filter((p: Guest) => p.id !== id),
            };
          }
          return g;
        });
    };

    const updatedGuests = removeGuestById(guests);
    await setGuests(updatedGuests);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing guest:', error);
    return NextResponse.json({ error: 'Failed to remove guest' }, { status: 500 });
  }
}
