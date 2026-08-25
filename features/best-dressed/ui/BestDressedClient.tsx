"use client";

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { playFeedback } from "@/lib/client/feedback";
import { SITE_NAME } from "@/lib/shared/config";
import { getStored, setStored, removeStored } from "@/lib/client/storage";
import { useHasMounted } from "@/hooks/useHasMounted";
import { useVisibilityReconciler } from "@/hooks/useVisibilityReconciler";
import {
  getBestDressedLeaderboardFn,
  getBestDressedSnapshotFn,
  searchBestDressedGuestsFn,
  voteBestDressedFn,
} from "@/features/best-dressed/best-dressed.functions";

type LeaderboardEntry = { name: string; count: number };
type StoredVote = { session: string; name: string };
type BestDressedSnapshot = {
  leaderboard: LeaderboardEntry[];
  totalVotes: number;
  session: string;
  voteToken: string;
  votedFor: string | null;
  codeRequired: boolean;
  openUntil: number | null;
};

type BestDressedClientProps = {
  initialSnapshot: BestDressedSnapshot;
};

const LEADERBOARD_REFRESH_INTERVAL_MS = 30_000;

export function BestDressedClient({ initialSnapshot }: BestDressedClientProps) {
  const hasMounted = useHasMounted();
  const [hasVoted, setHasVoted] = useState<string | null>(initialSnapshot.votedFor);
  const [currentSession, setCurrentSession] = useState<string>(
    initialSnapshot.session || "initial",
  );
  const [voteToken, setVoteToken] = useState<string>(initialSnapshot.voteToken || "");
  const [voteCode, setVoteCode] = useState<string>("");
  const [codeRequired, setCodeRequired] = useState(initialSnapshot.codeRequired !== false);
  const [openUntil, setOpenUntil] = useState<number | null>(
    typeof initialSnapshot.openUntil === "number" ? initialSnapshot.openUntil : null,
  );
  const [filteredGuests, setFilteredGuests] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(
    initialSnapshot.leaderboard || [],
  );
  const [totalVotes, setTotalVotes] = useState(initialSnapshot.totalVotes || 0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  useEffect(() => {
    // Deep links from printed or shared QR codes can include the vote code.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code && typeof code === "string") {
      setVoteCode(code.trim().toUpperCase());
    }
  }, []);

  useEffect(() => {
    // Check if user voted in THIS session (client-side tracking)
    const storedVote = getStored("bestDressedVote");
    if (storedVote) {
      try {
        const parsed: StoredVote = JSON.parse(storedVote);
        // Only count as voted if session matches
        if (parsed.session === currentSession) {
          setHasVoted(parsed.name);
        } else {
          // Session changed (votes were wiped), user can vote again
          removeStored("bestDressedVote");
        }
      } catch {
        removeStored("bestDressedVote");
      }
    }

    // Server-enforced "already voted" (cookie-bound).
    // This covers cases where localStorage was cleared or the user switched devices.
    if (
      !hasVoted &&
      typeof initialSnapshot.votedFor === "string" &&
      initialSnapshot.votedFor.trim()
    ) {
      setHasVoted(initialSnapshot.votedFor);
      setVoteToken("");
      const vote: StoredVote = {
        session: currentSession || "initial",
        name: initialSnapshot.votedFor,
      };
      setStored("bestDressedVote", JSON.stringify(vote));
    }
  }, [currentSession, hasVoted, initialSnapshot.votedFor]);

  useVisibilityReconciler({
    enabled: Boolean(hasVoted),
    intervalMs: LEADERBOARD_REFRESH_INTERVAL_MS,
    identity: hasVoted ? `best-dressed:${currentSession}` : null,
    minimumGapMs: 5_000,
    reconcile: async (isCurrent) => {
      const data = await getBestDressedLeaderboardFn();
      if (!isCurrent()) return;
      setLeaderboard(data.leaderboard || []);
      setTotalVotes(data.totalVotes || 0);
    },
  });

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2 || !voteToken || selectedName === query) {
      setFilteredGuests([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchBestDressedGuestsFn({
        data: { query, voteToken, ...(voteCode.trim() ? { code: voteCode.trim() } : {}) },
      })
        .then((result) => setFilteredGuests(result.names))
        .catch(() => setFilteredGuests([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery, selectedName, voteCode, voteToken]);

  const handleVote = async () => {
    if (!selectedName || !voteToken) return;

    setSubmitting(true);
    setVoteError(null);

    try {
      const codeToSend = voteCode.trim().toUpperCase();
      const result = await voteBestDressedFn({
        data: {
          name: selectedName,
          voteToken,
          ...(codeToSend ? { code: codeToSend } : {}),
        },
      });

      if (result.ok) {
        playFeedback("vote");
        const vote: StoredVote = { session: result.session || currentSession, name: selectedName };
        setStored("bestDressedVote", JSON.stringify(vote));
        setHasVoted(selectedName);
        setLeaderboard(result.leaderboard || []);
        setTotalVotes(result.totalVotes || 0);
        setVoteToken(""); // Token is consumed
        setVoteCode("");
        setCurrentSession(result.session || currentSession);
        setCodeRequired(result.codeRequired !== false);
        setOpenUntil(typeof result.openUntil === "number" ? result.openUntil : null);
      } else {
        const votedFor = typeof result.votedFor === "string" ? result.votedFor : null;
        if (votedFor) {
          const vote: StoredVote = { session: result.session || currentSession, name: votedFor };
          setStored("bestDressedVote", JSON.stringify(vote));
          setHasVoted(votedFor);
          setVoteToken("");
          setVoteError(null);
        } else {
          setVoteError(result.error || "Vote failed. Please refresh and try again.");
        }

        // If the server says a code is required, make sure the UI shows it.
        const errText = typeof result.error === "string" ? result.error.toLowerCase() : "";
        if (errText.includes("vote code") && errText.includes("required")) {
          setCodeRequired(true);
        }

        if (result.leaderboard) setLeaderboard(result.leaderboard);
        if (typeof result.totalVotes === "number") setTotalVotes(result.totalVotes);

        // If the token was invalid/expired, refresh snapshot to get a fresh token.
        if (result.status === 403) {
          const next = await getBestDressedSnapshotFn();
          setVoteToken(next.voteToken || "");
          setCodeRequired(next.codeRequired !== false);
          setOpenUntil(typeof next.openUntil === "number" ? next.openUntil : null);
          setCurrentSession(next.session || currentSession);
        }
      }
    } catch {
      setVoteError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const maxVotes = leaderboard[0]?.count || 1;
  const showCodeInput = codeRequired || !!voteCode.trim();
  const openUntilLabel =
    hasMounted && openUntil
      ? new Date(openUntil * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : null;

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <div className="mx-auto max-w-2xl px-6 pb-20 pt-14 sm:pt-20">
        <header className="border-b theme-border pb-8">
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            {SITE_NAME} presents
          </p>
          <h1 className="mt-3 font-serif text-5xl font-semibold tracking-tight sm:text-6xl">
            Best dressed
          </h1>
          <p className="mt-4 max-w-lg font-serif text-lg leading-relaxed theme-subtle">
            {hasVoted
              ? "Your vote is in. See how the room voted."
              : "Choose the person who understood the assignment."}
          </p>
        </header>

        <main id="main" className="py-8">
          {!hasVoted ? (
            <section aria-labelledby="cast-vote-heading" className="space-y-7">
              <h2 id="cast-vote-heading" className="font-mono text-sm font-bold">
                cast your vote
              </h2>
              <div className="relative">
                <label htmlFor="best-dressed-search" className="font-mono text-xs theme-muted">
                  find a ticket holder
                </label>
                <input
                  id="best-dressed-search"
                  type="search"
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSelectedName("");
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="type at least two letters"
                  role="combobox"
                  aria-expanded={showDropdown && filteredGuests.length > 0}
                  aria-controls="best-dressed-listbox"
                  aria-autocomplete="list"
                  className="mt-2 min-h-14 w-full border-b theme-border-strong bg-transparent font-serif text-xl outline-none placeholder:font-mono placeholder:text-sm placeholder:text-[var(--stone-400)] focus:border-[var(--foreground)]"
                />
                {showDropdown && filteredGuests.length > 0 ? (
                  <div
                    id="best-dressed-listbox"
                    role="listbox"
                    aria-label="Ticket holder suggestions"
                    className="absolute z-10 mt-2 w-full border-y theme-border bg-[var(--background)]"
                  >
                    {filteredGuests.map((name) => (
                      <button
                        type="button"
                        key={name}
                        role="option"
                        aria-selected={selectedName === name}
                        onClick={() => {
                          setSelectedName(name);
                          setSearchQuery(name);
                          setShowDropdown(false);
                        }}
                        className="block min-h-12 w-full border-b theme-border-faint px-1 py-3 text-left font-mono text-sm last:border-0 hover:opacity-60"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {selectedName ? (
                <div className="border-y theme-border py-5">
                  <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                    your choice
                  </p>
                  <p className="mt-2 font-serif text-3xl font-semibold">{selectedName}</p>
                </div>
              ) : null}

              {showCodeInput ? (
                <label className="block">
                  <span className="font-mono text-xs theme-muted">
                    {codeRequired ? "one-use vote code" : "vote code (optional)"}
                  </span>
                  <input
                    type="text"
                    value={voteCode}
                    onChange={(event) => setVoteCode(event.target.value.toUpperCase())}
                    placeholder="AMBER-CROWN"
                    className="mt-2 min-h-12 w-full border-b theme-border-strong bg-transparent text-center font-mono text-lg tracking-wider outline-none placeholder:text-[var(--stone-400)] focus:border-[var(--foreground)]"
                    autoCapitalize="characters"
                    autoCorrect="off"
                  />
                  {codeRequired ? (
                    <span className="mt-2 block font-mono text-micro theme-muted">
                      Ask the organiser for a code.
                    </span>
                  ) : null}
                </label>
              ) : (
                <p className="font-mono text-xs theme-muted">
                  Public voting is open{openUntilLabel ? ` until ${openUntilLabel}` : ""}. No code
                  is needed.
                </p>
              )}

              {voteError ? (
                <div
                  role="alert"
                  className="border-y theme-border py-4 font-mono text-xs text-[var(--prose-hashtag)]"
                >
                  <p>{voteError}</p>
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="mt-3 min-h-11 underline hover:opacity-70"
                  >
                    refresh and try again
                  </button>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void handleVote()}
                disabled={!selectedName || !voteToken || submitting}
                className="min-h-14 w-full rounded bg-[var(--foreground)] px-5 font-mono text-sm font-bold text-[var(--background)] hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "sending vote..." : "submit one vote"}
              </button>
              <p className="text-center font-mono text-micro theme-muted">
                One vote per person. Your choice cannot be changed.
              </p>
            </section>
          ) : (
            <section aria-labelledby="leaderboard-heading" className="space-y-7">
              <div className="border-y theme-border py-5">
                <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                  you voted for
                </p>
                <p className="mt-2 font-serif text-3xl font-semibold">{hasVoted}</p>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <h2 id="leaderboard-heading" className="font-mono text-sm font-bold">
                  leaderboard
                </h2>
                <p className="font-mono text-xs theme-muted">{totalVotes} total votes</p>
              </div>
              {leaderboard.length === 0 ? (
                <p className="border-y theme-border py-8 text-center font-mono text-xs theme-muted">
                  No results yet.
                </p>
              ) : (
                <ol className="divide-y theme-border border-y theme-border">
                  {leaderboard.map((entry, index) => (
                    <li key={`${entry.name}-${index}`} className="relative overflow-hidden py-4">
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 bg-[var(--selection-bg)]"
                        style={{ width: `${(entry.count / maxVotes) * 100}%` }}
                      />
                      <div className="relative flex min-h-8 items-center gap-4 px-2 font-mono text-sm">
                        <span className="w-6 theme-muted">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-bold">
                          {entry.name}
                          {entry.name === hasVoted ? (
                            <span className="ml-2 font-normal theme-muted">your vote</span>
                          ) : null}
                        </span>
                        <span className="font-bold">{entry.count}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </main>

        <footer className="border-t theme-border pt-6 font-mono text-micro theme-muted">
          <Link to="/events" className="inline-flex min-h-11 items-center hover:opacity-70">
            ← events
          </Link>
        </footer>
      </div>
    </div>
  );
}
