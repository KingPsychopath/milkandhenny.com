'use client';

import { useMemo, useState, useEffect } from 'react';
import { Guest, SearchFilter } from '@/lib/guests/types';

/** Debounce hook for search input */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  
  return debouncedValue;
}

export function useGuestSearch(guests: Guest[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const debouncedQuery = useDebouncedValue(searchQuery, 150);

  const filteredGuests = useMemo(() => {
    let result = guests;

    if (filter === 'invites') {
      result = result.filter((g) => !g.isPlusOne);
    } else if (filter === 'plusOnes') {
      result = result.filter((g) => g.isPlusOne || (g.plusOnes && g.plusOnes.length > 0));
    } else if (filter === 'checkedIn') {
      result = result.filter((g) => g.checkedIn || g.plusOnes?.some((p) => p.checkedIn));
    } else if (filter === 'notCheckedIn') {
      result = result.filter((g) => !g.checkedIn && !g.plusOnes?.some((p) => p.checkedIn));
    }

    if (!debouncedQuery.trim()) {
      return result;
    }

    const query = debouncedQuery.toLowerCase().trim();
    return result.filter((guest) => {
      const matchesName = guest.name.toLowerCase().includes(query);
      const matchesFullName = guest.fullName?.toLowerCase().includes(query);
      const matchesPlusOne = guest.plusOnes?.some((p) => {
        const pMatchesName = p.name.toLowerCase().includes(query);
        const pMatchesFullName = p.fullName?.toLowerCase().includes(query);
        return pMatchesName || pMatchesFullName;
      });
      return matchesName || matchesFullName || matchesPlusOne;
    });
  }, [guests, debouncedQuery, filter]);

  const searchStats = useMemo(() => {
    const invites = filteredGuests.filter((g) => !g.isPlusOne).length;
    const plusOnes = filteredGuests.reduce((sum, g) => sum + (g.plusOnes?.length || 0), 0);
    return { invites, plusOnes };
  }, [filteredGuests]);

  return {
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    filteredGuests,
    searchStats,
  };
}
