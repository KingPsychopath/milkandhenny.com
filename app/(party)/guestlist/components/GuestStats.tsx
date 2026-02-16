'use client';

import { useMemo } from 'react';
import { Guest, GuestStats as GuestStatsType } from '@/features/guests/types';

type GuestStatsProps = {
  guests: Guest[];
  loading: boolean;
};

/** Calculate stats from guest data */
function calculateStats(guests: Guest[]): GuestStatsType {
  let checkedInInvites = 0;
  let checkedInPlusOnes = 0;
  let totalPlusOnes = 0;

  guests.forEach((guest) => {
    if (guest.checkedIn) {
      checkedInInvites++;
    }
    if (guest.plusOnes) {
      totalPlusOnes += guest.plusOnes.length;
      guest.plusOnes.forEach((plusOne) => {
        if (plusOne.checkedIn) {
          checkedInPlusOnes++;
        }
      });
    }
  });

  return {
    totalInvites: guests.length,
    totalPlusOnes,
    checkedInInvites,
    checkedInPlusOnes,
    totalCheckedIn: checkedInInvites + checkedInPlusOnes,
  };
}

export function GuestStats({ guests, loading }: GuestStatsProps) {
  const stats = useMemo(() => calculateStats(guests), [guests]);
  const totalExpected = stats.totalInvites + stats.totalPlusOnes;
  const percentage = totalExpected > 0 ? Math.round((stats.totalCheckedIn / totalExpected) * 100) : 0;

  if (loading && guests.length === 0) {
    return (
      <div className="bg-gradient-to-br from-amber-600 via-amber-500 to-yellow-500 p-6">
        <div className="h-20 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-amber-600 via-amber-500 to-yellow-500 text-white p-5">
      {/* Main counter */}
      <div className="text-center mb-4">
        <div className="text-5xl font-bold tracking-tight">{stats.totalCheckedIn}</div>
        <div className="text-amber-100 text-sm mt-1">
          of {totalExpected} inside ({percentage}%)
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-white/20 rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-white rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white/15 rounded-2xl p-4 text-center backdrop-blur-sm">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-2xl font-bold">{stats.checkedInInvites}</span>
            <span className="text-amber-100 text-sm">/ {stats.totalInvites}</span>
          </div>
          <div className="text-amber-100 text-xs mt-1 font-medium">Invites</div>
        </div>
        <div className="bg-white/15 rounded-2xl p-4 text-center backdrop-blur-sm">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-2xl font-bold">{stats.checkedInPlusOnes}</span>
            <span className="text-amber-100 text-sm">/ {stats.totalPlusOnes}</span>
          </div>
          <div className="text-amber-100 text-xs mt-1 font-medium">Guests (+1s)</div>
        </div>
      </div>
    </div>
  );
}

