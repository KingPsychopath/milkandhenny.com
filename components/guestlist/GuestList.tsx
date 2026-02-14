'use client';

import { Guest } from '@/lib/guests/types';
import { GuestItem } from './GuestItem';

type GuestListProps = {
  guests: Guest[];
  onCheckIn: (id: string, checkedIn: boolean) => void;
  searchQuery: string;
};

export function GuestList({ guests, onCheckIn, searchQuery }: GuestListProps) {
  if (guests.length === 0 && searchQuery) {
    return (
      <div className="p-8 text-center">
        <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <p className="text-slate-600 font-medium">No guests found</p>
        <p className="text-slate-400 text-sm mt-1">Try a different search term</p>
      </div>
    );
  }

  if (guests.length === 0) {
    return null; // Empty state handled by parent
  }

  return (
    <div>
      {guests.map((guest) => (
        <GuestItem
          key={guest.id}
          guest={guest}
          onCheckIn={onCheckIn}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  );
}
