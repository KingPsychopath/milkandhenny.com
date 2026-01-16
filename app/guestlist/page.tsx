'use client';

import Image from 'next/image';
import { useGuests } from '@/hooks/useGuests';
import { useGuestSearch } from '@/hooks/useGuestSearch';
import { SearchBar } from '@/components/guestlist/SearchBar';
import { GuestList } from '@/components/guestlist/GuestList';
import { GuestStats } from '@/components/guestlist/GuestStats';
import { GuestManagement } from '@/components/guestlist/GuestManagement';

export default function GuestListPage() {
  const { guests, loading, error, updateCheckIn, refetch } = useGuests();
  const { searchQuery, setSearchQuery, filter, setFilter, filteredGuests, searchStats } = useGuestSearch(guests);

  if (loading && guests.length === 0) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 relative">
            <div className="absolute inset-0 rounded-full border-4 border-amber-200"></div>
            <div className="absolute inset-0 rounded-full border-4 border-amber-600 border-t-transparent animate-spin"></div>
          </div>
          <p className="text-stone-600 font-medium">Loading guest list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100">
      <GuestManagement 
        guests={guests} 
        onGuestAdded={refetch} 
        onGuestRemoved={refetch}
        onCSVImported={refetch}
      />
      
      <div className="max-w-lg mx-auto bg-white min-h-screen shadow-xl shadow-stone-300/50">
        {/* Header */}
        <header className="bg-gradient-to-br from-amber-600 via-amber-500 to-yellow-500 pt-safe">
          <div className="px-5 py-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-white/20 p-1 flex-shrink-0">
              <Image
                src="/Mahlogo.svg"
                alt="Logo"
                width={44}
                height={44}
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Guest List</h1>
              <p className="text-amber-100 text-sm mt-0.5">Tap to check in guests</p>
            </div>
          </div>
        </header>

        {/* Stats */}
        <GuestStats guests={guests} loading={loading} />
        
        {/* Search */}
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filter={filter}
          onFilterChange={setFilter}
          searchStats={searchStats}
        />

        {/* Error banner */}
        {error && (
          <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          </div>
        )}

        {/* Empty state */}
        {guests.length === 0 && !loading && (
          <div className="p-8 text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">No guests yet</h3>
            <p className="text-slate-500 mb-6">
              Import your guest list to get started
            </p>
            <p className="text-sm text-slate-400">
              Tap <strong>Manage</strong> below to import a CSV
            </p>
          </div>
        )}

        {/* Guest list */}
        <div className="pb-24" role="list" aria-label="Guest list">
          <GuestList
            guests={filteredGuests}
            onCheckIn={updateCheckIn}
            searchQuery={searchQuery}
          />
        </div>
      </div>
    </div>
  );
}
