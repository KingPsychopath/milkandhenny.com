'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Guest } from '@/lib/guests/types';

/** Poll interval when the tab is focused (ms) */
const POLL_ACTIVE_MS = 5_000;

/** Poll interval when the tab is in the background (ms) — saves KV commands */
const POLL_BACKGROUND_MS = 30_000;

/** Fetch with automatic retry for resilience */
async function fetchWithRetry(url: string, options?: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || i === retries) return res;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 500));
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
  throw new Error('Fetch failed after retries');
}

/**
 * Hook for guest list state with real-time polling.
 *
 * KV-efficient: polls at 5s when focused, 30s when backgrounded.
 * At 5s active: ~720 commands/hr. At 30s background: ~120 commands/hr.
 * Previous 2.5s interval burned ~1,440/hr — this halves active cost
 * and drops background cost by 12x.
 */
export function useGuests() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasBootstrapped = useRef(false);
  const consecutiveErrors = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGuests = useCallback(async () => {
    try {
      const res = await fetchWithRetry('/api/guests');
      if (!res.ok) throw new Error('Failed to fetch guests');
      const data = await res.json();
      if (Array.isArray(data)) {
        setGuests(data);
        setError(null);
        consecutiveErrors.current = 0;
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      consecutiveErrors.current++;
      if (consecutiveErrors.current >= 3) {
        setError(err instanceof Error ? err.message : 'Connection error');
      }
    } finally {
      setLoading(false);
    }
  }, []);

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
      console.warn('Bootstrap skipped:', err);
    }
  }, []);

  /** Restart the polling interval with the given delay */
  const startPolling = useCallback(
    (ms: number) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchGuests, ms);
    },
    [fetchGuests]
  );

  useEffect(() => {
    bootstrap().then(() => fetchGuests());

    // Start polling at active rate
    startPolling(POLL_ACTIVE_MS);

    // Switch rate based on tab visibility
    const onVisibilityChange = () => {
      if (document.hidden) {
        startPolling(POLL_BACKGROUND_MS);
      } else {
        // Fetch immediately when tab regains focus, then resume active rate
        fetchGuests();
        startPolling(POLL_ACTIVE_MS);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchGuests, bootstrap, startPolling]);

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
      }, 3);
      
      if (!res.ok) {
        setGuests(previousGuests);
        setError('Check-in failed - please try again');
        setTimeout(() => setError(null), 3000);
      }
    } catch {
      setGuests(previousGuests);
      setError('Check-in failed - please try again');
      setTimeout(() => setError(null), 3000);
    }
  }, [guests]);

  return { guests, loading, error, updateCheckIn, refetch: fetchGuests };
}
