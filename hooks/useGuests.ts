'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Guest } from '@/lib/types';

/** Fetch with automatic retry for resilience */
async function fetchWithRetry(url: string, options?: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || i === retries) return res;
      // Wait before retry (exponential backoff)
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 500));
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
  throw new Error('Fetch failed after retries');
}

export function useGuests() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasBootstrapped = useRef(false);
  const consecutiveErrors = useRef(0);

  const fetchGuests = useCallback(async () => {
    try {
      const res = await fetchWithRetry('/api/guests');
      if (!res.ok) throw new Error('Failed to fetch guests');
      const data = await res.json();
      // Validate response is an array
      if (Array.isArray(data)) {
        setGuests(data);
        setError(null);
        consecutiveErrors.current = 0;
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      consecutiveErrors.current++;
      // Only show error after 3 consecutive failures (avoid flashing on temporary issues)
      if (consecutiveErrors.current >= 3) {
        setError(err instanceof Error ? err.message : 'Connection error');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Bootstrap from public/guests.csv on first load (safe - only loads if empty)
  const bootstrap = useCallback(async () => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;
    
    try {
      const res = await fetchWithRetry('/api/guests/bootstrap', { method: 'POST' });
      const data = await res.json();
      if (data.bootstrapped) {
        console.log(`Bootstrapped ${data.count} guests from CSV`);
      }
    } catch (err) {
      // Bootstrap failure is not critical - data may already exist
      console.warn('Bootstrap skipped:', err);
    }
  }, []);

  useEffect(() => {
    // Try bootstrap first, then fetch
    bootstrap().then(() => fetchGuests());
    
    // Poll every 2.5 seconds for real-time sync
    const interval = setInterval(fetchGuests, 2500);
    return () => clearInterval(interval);
  }, [fetchGuests, bootstrap]);

  const updateCheckIn = useCallback(async (id: string, checkedIn: boolean) => {
    const previousGuests = guests;
    
    // Optimistic update for instant feedback
    setGuests((prev) =>
      prev.map((g) => {
        if (g.id === id) {
          return { ...g, checkedIn, checkedInAt: checkedIn ? new Date().toISOString() : undefined };
        }
        if (g.plusOnes) {
          return {
            ...g,
            plusOnes: g.plusOnes.map((p) =>
              p.id === id
                ? { ...p, checkedIn, checkedInAt: checkedIn ? new Date().toISOString() : undefined }
                : p
            ),
          };
        }
        return g;
      })
    );

    try {
      const res = await fetchWithRetry('/api/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, checkedIn }),
      }, 3); // More retries for check-in (critical action)
      
      if (!res.ok) {
        setGuests(previousGuests);
        setError('Check-in failed - please try again');
        // Clear error after 3 seconds
        setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      // Rollback on failure
      setGuests(previousGuests);
      setError('Check-in failed - please try again');
      setTimeout(() => setError(null), 3000);
    }
  }, [guests]);

  return { guests, loading, error, updateCheckIn, refetch: fetchGuests };
}
