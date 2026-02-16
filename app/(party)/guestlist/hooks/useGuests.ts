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
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, Math.pow(2, i) * 500));
    }
  }
  throw new Error('Fetch failed after retries');
}

/**
 * Hook for guest list state with real-time polling.
 *
 * Requires an auth token (JWT) — staff or admin. API routes accept admin as a superset.
 * All calls include `Authorization: Bearer {token}`.
 * Skips fetching when no token is provided (pre-auth state).
 *
 * KV-efficient: polls at 5s when focused, 30s when backgrounded.
 */
export function useGuests(authToken: string, onUnauthorized?: () => void) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const consecutiveErrors = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Build auth headers from the stored token. */
  const authHeaders = useCallback(
    (extra?: Record<string, string>): Record<string, string> => ({
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...extra,
    }),
    [authToken]
  );

  const fetchGuests = useCallback(async () => {
    if (!authToken) return; // Skip when not yet authenticated

    try {
      const res = await fetchWithRetry('/api/guests', {
        headers: authHeaders(),
      });
      if (res.status === 401) {
        onUnauthorized?.();
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
  }, [authToken, authHeaders, onUnauthorized]);

  /** Restart the polling interval with the given delay */
  const startPolling = useCallback(
    (ms: number) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(fetchGuests, ms);
    },
    [fetchGuests]
  );

  useEffect(() => {
    if (!authToken) {
      setLoading(false);
      return;
    }

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
  }, [authToken, fetchGuests, startPolling]);

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
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ id, checkedIn }),
          },
          3
        );

        if (res.status === 401) {
          onUnauthorized?.();
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
    [guests, authHeaders, onUnauthorized]
  );

  return { guests, loading, error, updateCheckIn, refetch: fetchGuests };
}

