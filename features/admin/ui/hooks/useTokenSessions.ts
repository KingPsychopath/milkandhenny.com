"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminTokenSessionsQuery } from "@/features/auth/token-sessions.queries";

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

const EMPTY_SESSIONS: TokenSession[] = [];

/**
 * The private Query entry owns the server snapshot. This hook only handles
 * local filtering and paging; revocation remains a separate command.
 */
export function useTokenSessions(params: { isAuthed: boolean }) {
  const sessionsQuery = useQuery({ ...adminTokenSessionsQuery, enabled: params.isAuthed });
  const sessions: TokenSession[] = sessionsQuery.data?.sessions ?? EMPTY_SESSIONS;
  const loading = sessionsQuery.isFetching;
  const loadError = sessionsQuery.error?.message ?? null;
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const refetch = sessionsQuery.refetch;
  const refresh = useCallback(async () => {
    if (params.isAuthed) await refetch();
  }, [params.isAuthed, refetch]);

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
