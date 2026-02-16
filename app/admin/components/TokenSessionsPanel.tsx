"use client";

import { useState } from "react";
import { TOKEN_SESSION_STATUS, type TokenSessionStatusKey } from "./tokenSessionsStatus";
import { useTokenSessions } from "../hooks/useTokenSessions";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

export function TokenSessionsPanel(props: {
  isAuthed: boolean;
  authFetch: AuthFetch;
  formatRemaining: (seconds: number) => string;
  ensureStepUpToken: () => Promise<string | null>;
  onError: (msg: string) => void;
  onStatus: (msg: string) => void;
}) {
  const { isAuthed, authFetch, formatRemaining, ensureStepUpToken, onError, onStatus } = props;

  const [revokeLoading, setRevokeLoading] = useState<string | null>(null);

  const {
    loading,
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
  } = useTokenSessions({ isAuthed, authFetch });

  const handleRevokeSingleSession = async (jti: string) => {
    if (!confirm(`Revoke this session?\n\n${jti}\n\nThis immediately invalidates that token.`)) {
      return;
    }
    setRevokeLoading(jti);
    onError("");
    onStatus("");
    try {
      const step = await ensureStepUpToken();
      if (!step) return;
      const res = await authFetch(`/api/admin/tokens/sessions/${encodeURIComponent(jti)}`, {
        method: "DELETE",
        headers: { "x-admin-step-up": step },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to revoke session");
      }
      onStatus("Session revoked.");
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to revoke session";
      onError(msg);
    } finally {
      setRevokeLoading(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs theme-muted">
          token sessions{" "}
          {counts.total > 0
            ? `(${counts.usable} usable${showInactive ? ` / ${counts.total} total` : ""})`
            : ""}
        </p>
        <div className="flex items-center gap-3">
          {counts.inactive > 0 ? (
            <button
              type="button"
              onClick={() => {
                setShowInactive((v) => !v);
                setShowAll(false);
              }}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
              title="Toggle showing revoked/expired/signed-out sessions."
            >
              {showInactive ? "hide inactive" : `show inactive (${counts.inactive})`}
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
            title="Refreshes the list of issued JWT sessions (by jti)."
          >
            {loading ? "refreshing..." : "refresh"}
          </button>
        </div>
      </div>

      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowAll(false);
        }}
        placeholder={`filter ${showInactive ? "sessions" : "usable sessions"} by role, ip, status, jti, user-agent`}
        className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-xs py-2 transition-colors placeholder:text-[var(--stone-400)]"
      />

      {filtered.length === 0 ? (
        <p className="font-mono text-xs theme-muted">
          No sessions found (or Redis not configured).
        </p>
      ) : (
        <div className="space-y-2">
          {visible.map((s) => {
            const expiresIn = s.exp - Math.floor(Date.now() / 1000);
            const issuedAgo = Math.max(0, Math.floor(Date.now() / 1000) - s.iat);
            const statusKey = s.status as TokenSessionStatusKey;
            const status = TOKEN_SESSION_STATUS[statusKey];

            return (
              <details key={s.jti} className="border theme-border rounded-md p-3">
                <summary
                  className="cursor-pointer select-none list-none"
                  title="Tap to expand for full details (jti, full user-agent)."
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm truncate">
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`w-1.5 h-1.5 rounded-full ${status.dotClass}`}
                          />
                          <span>
                            {s.role} · {status.label}
                          </span>
                        </span>
                      </p>
                      <p className="font-mono text-xs theme-muted truncate">
                        issued {formatRemaining(issuedAgo)} ago · expires in{" "}
                        {formatRemaining(expiresIn)}
                      </p>
                    </div>
                    <span className="font-mono text-xs theme-muted shrink-0">details</span>
                  </div>
                </summary>

                <div className="mt-3 pt-3 border-t theme-border space-y-2">
                  <p className="font-mono text-xs theme-muted">
                    jti:{" "}
                    <span className="text-[var(--foreground)]">{s.jti}</span>
                  </p>
                  <p className="font-mono text-xs theme-muted">
                    token version:{" "}
                    <span className="text-[var(--foreground)]">{s.tv}</span>
                  </p>
                  <p className="font-mono text-xs theme-muted">
                    ip:{" "}
                    <span className="text-[var(--foreground)]">{s.ip || "—"}</span>
                  </p>
                  <p className="font-mono text-xs theme-muted break-words">
                    user-agent:{" "}
                    <span className="text-[var(--foreground)]">{s.ua || "—"}</span>
                  </p>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="font-mono text-xs theme-muted">
                      status:{" "}
                      <span className="text-[var(--foreground)]">{s.status}</span>
                    </p>
                    <button
                      type="button"
                      disabled={s.status !== "active" || revokeLoading === s.jti}
                      onClick={() => void handleRevokeSingleSession(s.jti)}
                      className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                      title="Revokes only this one token session (by jti)."
                    >
                      {revokeLoading === s.jti ? "revoking..." : "revoke"}
                    </button>
                  </div>
                </div>
              </details>
            );
          })}

          {filtered.length > 12 ? (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
            >
              {showAll ? "show fewer sessions" : `show all sessions (${filtered.length})`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

