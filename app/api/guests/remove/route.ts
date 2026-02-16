import { NextRequest, NextResponse } from 'next/server';
import { getGuests, setGuests } from '@/lib/guests/kv-client';
import { requireAdminStepUp, requireAuth } from '@/lib/auth';
import { Guest } from '@/lib/guests/types';
import { apiError } from '@/lib/api-error';

export async function DELETE(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

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
    return apiError('guests.remove', 'Failed to remove guest', error);
  }
}
