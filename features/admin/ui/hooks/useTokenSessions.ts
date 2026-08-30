"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type TokenSession = {
  jti: string;
  role: "admin" | "upload";
  iat: number;
  exp: number;
  tv: number;
  ip?: string;
  ua?: string;
  source?: "browser" | "cli" | "unknown";
  status: "active" | "expired" | "revoked" | "invalidated";
};

type TokenSessionsResponse = {
  success: true;
  count: number;
  sessions: TokenSession[];
  now: number;
  currentTv: { admin: number; upload: number };
};

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

/**
 * Token sessions are stored server-side (Redis) and keyed by JWT jti.
 * This hook only handles list/filter/paging state; mutation (revoke) is handled elsewhere.
 */
export function useTokenSessions(params: { isAuthed: boolean; authFetch: AuthFetch }) {
  const { isAuthed, authFetch } = params;

  const [sessions, setSessions] = useState<TokenSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthed) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetch("/api/admin/tokens/sessions");
      const data = (await res.json().catch(() => ({}))) as Partial<TokenSessionsResponse> & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Session list could not be loaded");
      }
      setSessions(Array.isArray(data.sessions) ? (data.sessions as TokenSession[]) : []);
    } catch (error) {
      // Keep the last good snapshot visible while making the stale state explicit.
      setLoadError(error instanceof Error ? error.message : "Session list could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [authFetch, isAuthed]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const usable = sessions.filter((s) => s.status === "active").length;
    const total = sessions.length;
    return { usable, inactive: Math.max(0, total - usable), total };
  }, [sessions]);

  const filtered = useMemo(() => {
    const base = showInactive ? sessions : sessions.filter((s) => s.status === "active");
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((s) => {
      return (
        s.jti.toLowerCase().includes(q) ||
        s.role.toLowerCase().includes(q) ||
        (s.ip ?? "").toLowerCase().includes(q) ||
        (s.ua ?? "").toLowerCase().includes(q) ||
        (s.source ?? "unknown").toLowerCase().includes(q) ||
        s.status.toLowerCase().includes(q)
      );
    });
  }, [query, sessions, showInactive]);

  const visible = useMemo(() => {
    return showAll ? filtered : filtered.slice(0, 12);
  }, [filtered, showAll]);

  return {
    sessions,
    loading,
    loadError,
    query,
    setQuery,
    showInactive,
    setShowInactive,
    showAll,
    setShowAll,
    counts,
    filtered,
    visible,
    refresh,
  };
}
