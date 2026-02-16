'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { playFeedback } from '@/lib/client/feedback';
import { SITE_NAME } from '@/lib/shared/config';
import { getStored, setStored, removeStored } from '@/lib/client/storage';
import {
  getBestDressedLeaderboardSnapshotAction,
  getBestDressedSnapshotAction,
  voteBestDressedAction,
} from '@/features/best-dressed/actions';

type LeaderboardEntry = { name: string; count: number };
type StoredVote = { session: string; name: string };
type BestDressedSnapshot = {
  leaderboard: LeaderboardEntry[];
  guestNames: string[];
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

export function BestDressedClient({ initialSnapshot }: BestDressedClientProps) {
  const [hasVoted, setHasVoted] = useState<string | null>(initialSnapshot.votedFor);
  const [currentSession, setCurrentSession] = useState<string>(initialSnapshot.session || 'initial');
  const [voteToken, setVoteToken] = useState<string>(initialSnapshot.voteToken || '');
  const [voteCode, setVoteCode] = useState<string>('');
  const [codeRequired, setCodeRequired] = useState(initialSnapshot.codeRequired !== false);
  const [openUntil, setOpenUntil] = useState<number | null>(
    typeof initialSnapshot.openUntil === 'number' ? initialSnapshot.openUntil : null
  );
  const [guestNames, setGuestNames] = useState<string[]>(initialSnapshot.guestNames || []);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(initialSnapshot.leaderboard || []);
  const [totalVotes, setTotalVotes] = useState(initialSnapshot.totalVotes || 0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [loading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [voteError, setVoteError] = useState<string | null>(null);

  useEffect(() => {
    // Deep link: /best-dressed?code=amber-crown auto-fills the code field.
    // Handy for QR codes printed by door staff.
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code && typeof code === 'string') {
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
    if (!hasVoted && typeof initialSnapshot.votedFor === 'string' && initialSnapshot.votedFor.trim()) {
      setHasVoted(initialSnapshot.votedFor);
      setVoteToken('');
      const vote: StoredVote = { session: currentSession || 'initial', name: initialSnapshot.votedFor };
      setStored("bestDressedVote", JSON.stringify(vote));
    }
  }, [currentSession, hasVoted, initialSnapshot.votedFor]);

  // Poll for leaderboard updates only when user has voted and tab is visible (saves KV)
  useEffect(() => {
    if (!hasVoted) return;

    const POLL_MS = 30_000; // 30s — leaderboard rarely changes mid-party

    const fetchLeaderboard = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const data = await getBestDressedLeaderboardSnapshotAction();
      setLeaderboard(data.leaderboard || []);
      setTotalVotes(data.totalVotes || 0);
    };

    const interval = window.setInterval(() => {
      void fetchLeaderboard();
    }, POLL_MS);
    // Sync when tab becomes visible
    const onVisibilityChange = () => {
      if (!document.hidden) fetchLeaderboard();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [hasVoted]);

  // Filter guests by search
  const filteredGuests = useMemo(() => {
    if (!searchQuery.trim()) return guestNames.slice(0, 8);
    const q = searchQuery.toLowerCase();
    return guestNames.filter((n) => n.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery, guestNames]);

  const handleVote = async () => {
    if (!selectedName || !voteToken) return;

    setSubmitting(true);
    setVoteError(null);

    try {
      const codeToSend = voteCode.trim().toUpperCase();
      const result = await voteBestDressedAction({
        name: selectedName,
        voteToken,
        ...(codeToSend ? { code: codeToSend } : {}),
      });

      if (result.ok) {
        playFeedback('vote');
        const vote: StoredVote = { session: result.session || currentSession, name: selectedName };
        setStored("bestDressedVote", JSON.stringify(vote));
        setHasVoted(selectedName);
        setLeaderboard(result.leaderboard || []);
        setTotalVotes(result.totalVotes || 0);
        setVoteToken(''); // Token is consumed
        setVoteCode('');
        setCurrentSession(result.session || currentSession);
        setCodeRequired(result.codeRequired !== false);
        setOpenUntil(typeof result.openUntil === 'number' ? result.openUntil : null);
      } else {
        const votedFor = typeof result.votedFor === 'string' ? result.votedFor : null;
        if (votedFor) {
          const vote: StoredVote = { session: result.session || currentSession, name: votedFor };
          setStored("bestDressedVote", JSON.stringify(vote));
          setHasVoted(votedFor);
          setVoteToken('');
          setVoteError(null);
        } else {
          setVoteError(result.error || 'Vote failed. Please refresh and try again.');
        }

        // If the server says a code is required, make sure the UI shows it.
        const errText = typeof result.error === 'string' ? result.error.toLowerCase() : '';
        if (errText.includes('vote code') && errText.includes('required')) {
          setCodeRequired(true);
        }

        if (result.leaderboard) setLeaderboard(result.leaderboard);
        if (typeof result.totalVotes === 'number') setTotalVotes(result.totalVotes);

        // If the token was invalid/expired, refresh snapshot to get a fresh token.
        if (result.status === 403) {
          const next = await getBestDressedSnapshotAction();
          setVoteToken(next.voteToken || '');
          setCodeRequired(next.codeRequired !== false);
          setOpenUntil(typeof next.openUntil === 'number' ? next.openUntil : null);
          setCurrentSession(next.session || currentSession);
        }
      }
    } catch {
      setVoteError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-purple-950/30 to-zinc-950 flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const maxVotes = leaderboard[0]?.count || 1;
  const showCodeInput = codeRequired || !!voteCode.trim();

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-purple-950/30 to-zinc-950">
      <div className="max-w-lg mx-auto px-5 py-8">
        {/* Header */}
        <header role="banner" className="text-center mb-8">
          <div className="text-5xl mb-3">👑</div>
          <h1 className="text-3xl font-bold text-white mb-2">Best Dressed</h1>
          <p className="text-purple-300/80">
            {hasVoted ? 'Thanks for voting!' : 'Who\'s serving looks tonight?'}
          </p>
        </header>

        <main id="main">
          {!hasVoted ? (
            /* Voting UI */
            <div className="space-y-6">
              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search for a guest..."
                  role="combobox"
                  aria-expanded={showDropdown && filteredGuests.length > 0}
                  aria-controls="best-dressed-listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    selectedName ? `bd-option-${selectedName.replace(/\s+/g, '-')}` : undefined
                  }
                  className="w-full px-5 py-4 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-lg"
                />

                {/* Dropdown */}
                {showDropdown && filteredGuests.length > 0 && (
                  <div
                    id="best-dressed-listbox"
                    role="listbox"
                    aria-label="Guest suggestions"
                    className="absolute z-10 w-full mt-2 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
                  >
                    {filteredGuests.map((name) => (
                      <button
                        key={name}
                        id={`bd-option-${name.replace(/\s+/g, '-')}`}
                        role="option"
                        aria-selected={selectedName === name}
                        onClick={() => {
                          setSelectedName(name);
                          setSearchQuery(name);
                          setShowDropdown(false);
                        }}
                        className={`w-full text-left px-5 py-3.5 transition-colors ${
                          selectedName === name ? 'bg-purple-600 text-white' : 'text-white/80 hover:bg-white/10'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Selected */}
              {selectedName && (
                <div className="bg-gradient-to-r from-pink-500/20 to-purple-600/20 border border-purple-500/30 rounded-2xl p-5 text-center">
                  <p className="text-purple-300 text-sm mb-1">Your vote</p>
                  <p className="text-2xl font-bold text-white">{selectedName}</p>
                </div>
              )}

              {/* Error message */}
              {voteError && (
                <div className="bg-red-500/20 border border-red-500/30 rounded-2xl p-4 text-center">
                  <p className="text-red-300 text-sm">{voteError}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-2 text-red-400 hover:text-red-300 text-sm underline"
                  >
                    Refresh page to try again
                  </button>
                </div>
              )}

              {showCodeInput ? (
                <div className="space-y-2">
                  <p className="text-center text-zinc-500 text-sm">
                    {codeRequired ? 'Ask staff for a vote code' : 'Vote code (optional)'}
                  </p>
                  <input
                    type="text"
                    value={voteCode}
                    onChange={(e) => setVoteCode(e.target.value.toUpperCase())}
                    placeholder="AMBER-CROWN"
                    className="w-full px-5 py-4 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-lg font-mono tracking-wider text-center"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                  />
                </div>
              ) : (
                <p className="text-center text-zinc-500 text-sm">
                  Voting is open right now — no code needed
                  {openUntil ? ` (until ${new Date(openUntil * 1000).toLocaleTimeString()})` : ''}
                </p>
              )}

              {/* Vote Button */}
              <button
                onClick={handleVote}
                disabled={!selectedName || !voteToken || submitting}
                className="w-full py-5 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xl rounded-2xl transition-all shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-[1.02] disabled:hover:scale-100"
              >
                {submitting ? (
                  <span className="inline-flex items-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Voting...
                  </span>
                ) : (
                  'Cast Your Vote 👑'
                )}
              </button>

              <p className="text-center text-zinc-500 text-sm">You can only vote once</p>
            </div>
          ) : (
            /* Leaderboard */
            <div className="space-y-6">
              {/* Your vote badge */}
              <div className="bg-gradient-to-r from-pink-500/20 to-purple-600/20 border border-purple-500/30 rounded-2xl p-4 text-center">
                <p className="text-purple-300 text-sm">You voted for</p>
                <p className="text-xl font-bold text-white">{hasVoted}</p>
              </div>

              {/* Stats */}
              <div className="text-center text-zinc-400">{totalVotes} total votes</div>

              {/* Leaderboard */}
              <div className="space-y-3">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <span>🏆</span> Leaderboard
                </h2>

                {leaderboard.length === 0 ? (
                  <p className="text-zinc-500 text-center py-8">No votes yet</p>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((entry, index) => (
                      <div key={`${entry.name}-${index}`} className="relative bg-white/5 rounded-xl overflow-hidden">
                        {/* Progress bar */}
                        <div
                          className="absolute inset-0 bg-gradient-to-r from-pink-500/30 to-purple-600/30"
                          style={{ width: `${(entry.count / maxVotes) * 100}%` }}
                        />

                        {/* Content */}
                        <div className="relative flex items-center justify-between px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className="text-xl">
                              {index === 0 ? '👑' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`}
                            </span>
                            <span className={`font-medium ${entry.name === hasVoted ? 'text-purple-300' : 'text-white'}`}>
                              {entry.name}
                              {entry.name === hasVoted && <span className="ml-2 text-xs text-purple-400">(your vote)</span>}
                            </span>
                          </div>
                          <span className="text-white font-bold">{entry.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* Back link */}
        <footer role="contentinfo" className="mt-10 text-center space-y-2">
          <Link href="/party" className="text-zinc-500 hover:text-purple-400 text-sm transition-colors block">
            ← Back to party
          </Link>
          <p className="text-zinc-600 text-xs">
            © {new Date().getFullYear()} {SITE_NAME}
          </p>
        </footer>
      </div>
    </div>
  );
}

