"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { copyText } from "@/lib/client/share";
import { useActionDialog } from "@/hooks/useActionDialog";
import { AdminStatus } from "./AdminStatus";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

interface VotingWindow {
  isOpen: boolean;
  openUntil: number | null;
  secondsRemaining: number;
}

interface VotingSnapshot {
  leaderboard: Array<{ name: string; count: number }>;
  totalVotes: number;
}

function formatWindow(value: number | null): string {
  if (!value) return "closed";
  return new Date(value * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export function BestDressedPanel({
  authFetch,
  ensureStepUpToken,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  ensureStepUpToken: () => Promise<string | null>;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<VotingSnapshot | null>(null);
  const [windowState, setWindowState] = useState<VotingWindow | null>(null);
  const [windowMinutes, setWindowMinutes] = useState("30");
  const [codeCount, setCodeCount] = useState("20");
  const [codeMinutes, setCodeMinutes] = useState("360");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const { confirm, dialog } = useActionDialog();

  const refresh = useCallback(async () => {
    setBusy("refresh");
    onError("");
    try {
      const [snapshotResponse, windowResponse] = await Promise.all([
        authFetch("/api/best-dressed"),
        authFetch("/api/best-dressed/voting/open"),
      ]);
      const snapshotData = (await snapshotResponse
        .json()
        .catch(() => null)) as VotingSnapshot | null;
      const windowData = (await windowResponse.json().catch(() => null)) as VotingWindow | null;
      if (!snapshotResponse.ok || !snapshotData) throw new Error("Failed to load voting results");
      if (!windowResponse.ok || !windowData) throw new Error("Failed to load voting controls");
      setSnapshot(snapshotData);
      setWindowState(windowData);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to load best-dressed controls");
    } finally {
      setBusy(null);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setVotingWindow = async (minutes: number) => {
    setBusy("window");
    onError("");
    try {
      const response = await authFetch("/api/best-dressed/voting/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      const data = (await response.json().catch(() => null)) as VotingWindow | null;
      if (!response.ok || !data) throw new Error("Failed to update the voting window");
      setWindowState(data);
      onStatus(minutes > 0 ? `Voting is open for ${minutes} minutes.` : "Voting is closed.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to update the voting window");
    } finally {
      setBusy(null);
    }
  };

  const mintCodes = async () => {
    setBusy("codes");
    onError("");
    try {
      const response = await authFetch("/api/best-dressed/codes/mint-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          count: Number.parseInt(codeCount, 10),
          ttlMinutes: Number.parseInt(codeMinutes, 10),
          words: 2,
        }),
      });
      const data = (await response.json().catch(() => null)) as {
        codes?: string[];
        error?: string;
      } | null;
      if (!response.ok || !data?.codes) throw new Error(data?.error ?? "Failed to create codes");
      setCodes(data.codes);
      onStatus(`${data.codes.length} vote codes created.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to create vote codes");
    } finally {
      setBusy(null);
    }
  };

  const revokeCodes = async () => {
    const accepted = await confirm({
      eyebrow: "best dressed",
      title: "Revoke every unused vote code?",
      description: "Printed and shared codes will stop working immediately.",
      confirmLabel: "revoke codes",
      intent: "danger",
    });
    if (!accepted) return;
    setBusy("revoke-codes");
    try {
      const response = await authFetch("/api/best-dressed/codes/revoke-all", { method: "POST" });
      if (!response.ok) throw new Error("Failed to revoke vote codes");
      setCodes([]);
      onStatus("All unused vote codes were revoked.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to revoke vote codes");
    } finally {
      setBusy(null);
    }
  };

  const clearVotes = async () => {
    const accepted = await confirm({
      eyebrow: "best dressed",
      title: "Clear all votes and start a new round?",
      description: "This permanently removes the current leaderboard and lets everyone vote again.",
      confirmLabel: "clear votes",
      intent: "danger",
    });
    if (!accepted) return;
    const stepUp = await ensureStepUpToken();
    if (!stepUp) return;
    setBusy("clear");
    try {
      const response = await authFetch("/api/best-dressed", {
        method: "DELETE",
        headers: { "x-admin-step-up": stepUp },
      });
      if (!response.ok) throw new Error("Failed to clear votes");
      setSnapshot({ leaderboard: [], totalVotes: 0 });
      onStatus("Votes cleared. A new round is ready.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to clear votes");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="best-dressed-heading" className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b theme-border pb-6">
        <div>
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            party vote
          </p>
          <h2
            id="best-dressed-heading"
            className="mt-2 font-serif text-3xl font-semibold tracking-tight"
          >
            Best dressed
          </h2>
          <p className="mt-2 max-w-lg font-mono text-xs leading-relaxed theme-muted">
            Open voting, create one-use codes, and watch the results from one place.
          </p>
        </div>
        <Link
          to="/best-dressed"
          className="inline-flex min-h-11 items-center border-b theme-border-strong font-mono text-xs hover:opacity-70"
        >
          open voting page ↗
        </Link>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="voting-window-heading" className="space-y-4">
          <div>
            <h3 id="voting-window-heading" className="font-mono text-sm font-bold">
              voting window
            </h3>
            <AdminStatus
              tone={windowState?.isOpen ? "positive" : "neutral"}
              className="mt-1 font-mono text-xs"
            >
              {windowState?.isOpen
                ? `open until ${formatWindow(windowState.openUntil)}`
                : "closed · a code is required"}
            </AdminStatus>
          </div>
          <label className="block">
            <span className="font-mono text-micro theme-muted">minutes</span>
            <input
              type="number"
              min="1"
              max="120"
              value={windowMinutes}
              onChange={(event) => setWindowMinutes(event.target.value)}
              className="mt-1 min-h-11 w-full border-b theme-border bg-transparent font-mono text-sm outline-none focus:border-[var(--foreground)]"
            />
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void setVotingWindow(Math.max(1, Number.parseInt(windowMinutes, 10) || 30))
              }
              className="min-h-11 flex-1 rounded bg-[var(--foreground)] px-4 font-mono text-xs text-[var(--background)] hover:opacity-80 disabled:opacity-50"
            >
              {busy === "window" ? "updating..." : "open voting"}
            </button>
            <button
              type="button"
              disabled={busy !== null || !windowState?.isOpen}
              onClick={() => void setVotingWindow(0)}
              className="min-h-11 border-b theme-border-strong px-3 font-mono text-xs hover:opacity-70 disabled:opacity-40"
            >
              close
            </button>
          </div>
        </section>

        <section aria-labelledby="vote-codes-heading" className="space-y-4">
          <div>
            <h3 id="vote-codes-heading" className="font-mono text-sm font-bold">
              one-use codes
            </h3>
            <p className="mt-1 font-mono text-xs theme-muted">
              Use codes when public voting is closed.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="font-mono text-micro theme-muted">quantity</span>
              <input
                type="number"
                min="1"
                max="200"
                value={codeCount}
                onChange={(event) => setCodeCount(event.target.value)}
                className="mt-1 min-h-11 w-full border-b theme-border bg-transparent font-mono text-sm outline-none focus:border-[var(--foreground)]"
              />
            </label>
            <label>
              <span className="font-mono text-micro theme-muted">valid for minutes</span>
              <input
                type="number"
                min="15"
                max="720"
                value={codeMinutes}
                onChange={(event) => setCodeMinutes(event.target.value)}
                className="mt-1 min-h-11 w-full border-b theme-border bg-transparent font-mono text-sm outline-none focus:border-[var(--foreground)]"
              />
            </label>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void mintCodes()}
              className="min-h-11 flex-1 rounded bg-[var(--foreground)] px-4 font-mono text-xs text-[var(--background)] hover:opacity-80 disabled:opacity-50"
            >
              {busy === "codes" ? "creating..." : "create codes"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void revokeCodes()}
              className="min-h-11 border-b theme-border-strong px-3 font-mono text-xs hover:opacity-70 disabled:opacity-40"
            >
              revoke all
            </button>
          </div>
        </section>
      </div>

      {codes.length > 0 ? (
        <section aria-labelledby="new-codes-heading" className="border-y theme-border py-5">
          <div className="flex items-center justify-between gap-3">
            <h3 id="new-codes-heading" className="font-mono text-xs font-bold">
              new codes
            </h3>
            <button
              type="button"
              onClick={() =>
                void copyText(codes.join("\n")).then(() => onStatus("Vote codes copied."))
              }
              className="min-h-11 font-mono text-xs theme-muted hover:opacity-70"
            >
              copy all
            </button>
          </div>
          <ol className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm sm:grid-cols-3">
            {codes.map((code) => (
              <li key={code}>{code.toUpperCase()}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-labelledby="leaderboard-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="leaderboard-heading" className="font-mono text-sm font-bold">
              leaderboard
            </h3>
            <p className="mt-1 font-mono text-xs theme-muted">
              {snapshot?.totalVotes ?? 0} total votes
            </p>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void refresh()}
              className="min-h-11 font-mono text-xs theme-muted hover:opacity-70 disabled:opacity-40"
            >
              {busy === "refresh" ? "refreshing..." : "refresh"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void clearVotes()}
              className="min-h-11 font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-70 disabled:opacity-40"
            >
              {busy === "clear" ? "clearing..." : "clear votes"}
            </button>
          </div>
        </div>
        {snapshot?.leaderboard.length ? (
          <ol className="divide-y theme-border border-y theme-border">
            {snapshot.leaderboard.map((entry, index) => (
              <li
                key={entry.name}
                className="flex min-h-12 items-center gap-4 py-2 font-mono text-sm"
              >
                <span className="w-6 theme-muted">{index + 1}</span>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="font-bold">{entry.count}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-y theme-border py-6 font-mono text-xs theme-muted">No votes yet.</p>
        )}
      </section>
      {dialog}
    </section>
  );
}
