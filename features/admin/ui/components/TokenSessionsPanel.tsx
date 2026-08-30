"use client";

import { useEffect, useState } from "react";
import { TOKEN_SESSION_STATUS, type TokenSessionStatusKey } from "./tokenSessionsStatus";
import { useTokenSessions } from "../hooks/useTokenSessions";
import { useActionDialog } from "@/hooks/useActionDialog";
import { AdminStatus } from "./AdminStatus";

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
  const [nowSeconds, setNowSeconds] = useState<number | null>(null);
  const { confirm: confirmAction, dialog: actionDialog } = useActionDialog();

  useEffect(() => {
    const updateNow = () => setNowSeconds(Math.floor(Date.now() / 1000));
    updateNow();
    const interval = window.setInterval(updateNow, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const {
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
  } = useTokenSessions({ isAuthed, authFetch });

  const handleRevokeSingleSession = async (jti: string) => {
    if (
      !(await confirmAction({
        eyebrow: "session security",
        title: "Revoke this session?",
        description: (
          <>
            Token <span className="font-mono text-xs break-all">{jti}</span> will immediately stop
            working.
          </>
        ),
        confirmLabel: "revoke session",
        intent: "danger",
      }))
    ) {
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
      const data = (await res.json().catch(() => ({}))) as { error?: string };
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-xs theme-muted">
          token sessions{" "}
          {counts.total > 0
            ? `(${counts.usable} usable${showInactive ? ` / ${counts.total} total` : ""})`
            : ""}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {counts.inactive > 0 ? (
            <button
              type="button"
              onClick={() => {
                setShowInactive((v) => !v);
                setShowAll(false);
              }}
              className="inline-flex min-h-11 items-center font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
              title="Toggle showing revoked/expired/signed-out sessions."
            >
              {showInactive ? "hide inactive" : `show inactive (${counts.inactive})`}
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            className="inline-flex min-h-11 items-center font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
            title="Refreshes the list of issued JWT sessions (by jti)."
          >
            {loading ? "refreshing..." : "refresh"}
          </button>
        </div>
      </div>

      <label htmlFor="admin-session-filter" className="sr-only">
        Filter token sessions
      </label>
      <input
        id="admin-session-filter"
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowAll(false);
        }}
        placeholder={`filter ${showInactive ? "sessions" : "usable sessions"} by role, ip, status, jti, user-agent`}
        className="min-h-11 w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-xs py-2 transition-colors placeholder:text-[var(--stone-400)]"
      />

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y theme-border py-3">
          <p role="alert">
            <AdminStatus tone="danger" className="font-mono text-xs">
              {loadError}. Showing the last successful snapshot.
            </AdminStatus>
          </p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void refresh()}
            className="inline-flex min-h-11 items-center font-mono text-xs underline disabled:opacity-50"
          >
            retry
          </button>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="font-mono text-xs theme-muted">No matching sessions.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((s) => {
            const expiresIn = nowSeconds === null ? null : s.exp - nowSeconds;
            const issuedAgo = nowSeconds === null ? null : Math.max(0, nowSeconds - s.iat);
            const statusKey = s.status as TokenSessionStatusKey;
            const status = TOKEN_SESSION_STATUS[statusKey];

            return (
              <details key={s.jti} className="border theme-border rounded-md p-3">
                <summary
                  className="flex min-h-11 cursor-pointer select-none list-none items-center"
                  title="Tap to expand for full details (jti, full user-agent)."
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-sm truncate">
                        {s.role} · <AdminStatus tone={status.tone}>{status.label}</AdminStatus>
                      </p>
                      <p className="font-mono text-xs theme-muted truncate">
                        {s.source === "cli"
                          ? "CLI · terminal session"
                          : s.source === "browser"
                            ? "browser session"
                            : "older session"}
                      </p>
                      <p className="font-mono text-xs theme-muted truncate">
                        issued {issuedAgo === null ? "—" : `${formatRemaining(issuedAgo)} ago`} ·
                        expires in {expiresIn === null ? "—" : formatRemaining(expiresIn)}
                      </p>
                    </div>
                    <span className="font-mono text-xs theme-muted shrink-0">details</span>
                  </div>
                </summary>

                <div className="mt-3 pt-3 border-t theme-border space-y-2">
                  <p className="font-mono text-xs theme-muted">
                    jti: <span className="text-[var(--foreground)]">{s.jti}</span>
                  </p>
                  <p className="font-mono text-xs theme-muted">
                    token version: <span className="text-[var(--foreground)]">{s.tv}</span>
                  </p>
                  <p className="font-mono text-xs theme-muted">
                    ip: <span className="text-[var(--foreground)]">{s.ip || "—"}</span>
                  </p>
                  <p className="font-mono text-xs theme-muted">
                    source:{" "}
                    <span className="text-[var(--foreground)]">{s.source ?? "unknown"}</span>
                  </p>
                  <p className="font-mono text-xs theme-muted break-words">
                    user-agent: <span className="text-[var(--foreground)]">{s.ua || "—"}</span>
                  </p>

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p className="font-mono text-xs theme-muted">
                      status: <AdminStatus tone={status.tone}>{status.label}</AdminStatus>
                    </p>
                    <button
                      type="button"
                      disabled={s.status !== "active" || revokeLoading === s.jti}
                      onClick={() => void handleRevokeSingleSession(s.jti)}
                      className="inline-flex min-h-11 items-center font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
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
              className="inline-flex min-h-11 items-center font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
            >
              {showAll ? "show fewer sessions" : `show all sessions (${filtered.length})`}
            </button>
          ) : null}
        </div>
      )}
      {actionDialog}
    </div>
  );
}
