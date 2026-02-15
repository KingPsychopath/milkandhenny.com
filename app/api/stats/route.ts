import { NextResponse } from 'next/server';
import { getGuests } from '@/lib/guests/kv-client';
import { GuestStats, Guest } from '@/lib/guests/types';
import { apiError } from '@/lib/api-error';

function countCheckedIn(guests: Guest[]): { invites: number; plusOnes: number } {
  let invites = 0;
  let plusOnes = 0;

  guests.forEach((guest: Guest) => {
    if (guest.checkedIn && !guest.isPlusOne) {
      invites++;
    }
    if (guest.plusOnes) {
      guest.plusOnes.forEach((plusOne: Guest) => {
        if (plusOne.checkedIn) {
          plusOnes++;
        }
      });
    }
  });

  return { invites, plusOnes };
}

export async function GET() {
  try {
    const guests = await getGuests();
    
    const totalInvites = guests.filter((g: Guest) => !g.isPlusOne).length;
    const totalPlusOnes = guests.reduce((sum: number, g: Guest) => {
      return sum + (g.plusOnes?.length || 0);
    }, 0);

    const { invites, plusOnes } = countCheckedIn(guests);

    const stats: GuestStats = {
      totalInvites,
      totalPlusOnes,
      checkedInInvites: invites,
      checkedInPlusOnes: plusOnes,
      totalCheckedIn: invites + plusOnes,
    };

    return NextResponse.json(stats);
  } catch (error) {
    return apiError('stats', 'Failed to fetch stats', error);
  }
}
