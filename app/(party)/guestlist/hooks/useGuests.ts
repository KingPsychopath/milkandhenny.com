'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Guest } from '@/features/guests/types';
import { fetchWithRetry } from '@/lib/http/fetch-with-retry';

/** Poll interval when the tab is focused (ms) */
// This hits KV on every poll. 10s still feels "live" but halves read volume vs 5s.
const POLL_ACTIVE_MS = 10_000;

/** Poll interval when the tab is in the background (ms) — saves KV commands */
const POLL_BACKGROUND_MS = 60_000;

// Absolute safety net: even if someone reintroduces a render-loop regression,
// never allow guest polling to hammer KV at ~1req/sec.
const MIN_GUEST_FETCH_GAP_MS = 2_000;

/**
 * Hook for guest list state with real-time polling.
 *
 * KV-efficient: polls at 10s when focused, 60s when backgrounded.
 */
type UseGuestsOptions = {
  initialGuests?: Guest[];
  onUnauthorized?: () => void;
};

export function useGuests(opts: UseGuestsOptions = {}) {
  const { initialGuests, onUnauthorized } = opts;

  const [guests, setGuests] = useState<Guest[]>(() => initialGuests ?? []);
  const [loading, setLoading] = useState(() => initialGuests == null);
  const [error, setError] = useState<string | null>(null);
  const consecutiveErrors = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onUnauthorizedRef = useRef<(() => void) | undefined>(onUnauthorized);
  const lastGuestFetchAtMs = useRef(0);

  useEffect(() => {
    onUnauthorizedRef.current = onUnauthorized;
  }, [onUnauthorized]);

  useEffect(() => {
    if (initialGuests) {
      setGuests(initialGuests);
      setLoading(false);
    }
  }, [initialGuests]);

  const fetchGuests = useCallback(async () => {
    const now = Date.now();
    if (now - lastGuestFetchAtMs.current < MIN_GUEST_FETCH_GAP_MS) return;
    lastGuestFetchAtMs.current = now;

    try {
      const res = await fetchWithRetry(
        '/api/guests',
        {},
        { retries: 2, baseDelayMs: 500 }
      );
      if (res.status === 401) {
        onUnauthorizedRef.current?.();
        return;
      }
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

  /** Restart the polling interval with the given delay */
  const startPolling = useCallback(
    (ms: number) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchGuests, ms);
    },
    [fetchGuests]
  );

  useEffect(() => {
    fetchGuests();
    startPolling(POLL_ACTIVE_MS);

    const onVisibilityChange = () => {
      if (document.hidden) {
        startPolling(POLL_BACKGROUND_MS);
      } else {
        fetchGuests();
        startPolling(POLL_ACTIVE_MS);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [fetchGuests, startPolling]);

  const updateCheckIn = useCallback(
    async (id: string, checkedIn: boolean) => {
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
                p.id === id ? { ...p, checkedIn, checkedInAt: checkedIn ? new Date().toISOString() : undefined } : p
              ),
            };
          }
          return g;
        })
      );

      try {
        const res = await fetchWithRetry(
          '/api/guests',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, checkedIn }),
          },
          { retries: 3, baseDelayMs: 500 }
        );

        if (res.status === 401) {
          onUnauthorizedRef.current?.();
          return;
        }
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
    },
    [guests]
  );

  return { guests, loading, error, updateCheckIn, refetch: fetchGuests };
}

