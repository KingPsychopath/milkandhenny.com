'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'mah-best-dressed-vote';

/** Trigger haptic feedback on supported devices */
function hapticFeedback(type: 'light' | 'success' | 'celebration') {
  if (typeof window === 'undefined' || !navigator.vibrate) return;
  
  switch (type) {
    case 'light':
      navigator.vibrate(10);
      break;
    case 'success':
      navigator.vibrate([15, 50, 15]);
      break;
    case 'celebration':
      // Celebratory pattern for voting
      navigator.vibrate([30, 80, 30, 80, 50]);
      break;
  }
}

type LeaderboardEntry = { name: string; count: number };
type StoredVote = { session: string; name: string };

export default function BestDressedPage() {
  const [hasVoted, setHasVoted] = useState<string | null>(null);
  const [currentSession, setCurrentSession] = useState<string>('');
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [totalVotes, setTotalVotes] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Check if already voted (session-aware)
  useEffect(() => {
    // Fetch data and session
    fetch('/api/best-dressed')
      .then(res => res.json())
      .then(data => {
        setGuestNames(data.guestNames || []);
        setLeaderboard(data.leaderboard || []);
        setTotalVotes(data.totalVotes || 0);
        setCurrentSession(data.session || 'initial');
        
        // Check if user voted in THIS session
        const storedVote = localStorage.getItem(STORAGE_KEY);
        if (storedVote) {
          try {
            const parsed: StoredVote = JSON.parse(storedVote);
            // Only count as voted if session matches
            if (parsed.session === data.session) {
              setHasVoted(parsed.name);
            } else {
              // Session changed (votes were wiped), user can vote again
              localStorage.removeItem(STORAGE_KEY);
            }
          } catch {
            localStorage.removeItem(STORAGE_KEY);
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Poll for leaderboard updates
  useEffect(() => {
    if (!hasVoted) return;
    
    const interval = setInterval(() => {
      fetch('/api/best-dressed')
        .then(res => res.json())
        .then(data => {
          setLeaderboard(data.leaderboard || []);
          setTotalVotes(data.totalVotes || 0);
        });
    }, 5000);
    
    return () => clearInterval(interval);
  }, [hasVoted]);

  // Filter guests by search
  const filteredGuests = useMemo(() => {
    if (!searchQuery.trim()) return guestNames.slice(0, 8);
    const q = searchQuery.toLowerCase();
    return guestNames.filter(n => n.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery, guestNames]);

  const handleVote = async () => {
    if (!selectedName) return;
    
    setSubmitting(true);
    try {
      const res = await fetch('/api/best-dressed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedName }),
      });
      
      if (res.ok) {
        const data = await res.json();
        hapticFeedback('celebration');
        // Store vote with session ID
        const vote: StoredVote = { session: data.session || currentSession, name: selectedName };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(vote));
        setHasVoted(selectedName);
        setLeaderboard(data.leaderboard || []);
        setTotalVotes(data.totalVotes || 0);
      }
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-purple-950/30 to-zinc-950">
      <div className="max-w-lg mx-auto px-5 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">👑</div>
          <h1 className="text-3xl font-bold text-white mb-2">Best Dressed</h1>
          <p className="text-purple-300/80">
            {hasVoted ? 'Thanks for voting!' : 'Who\'s serving looks tonight?'}
          </p>
        </div>

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
                className="w-full px-5 py-4 bg-white/10 border border-white/20 rounded-2xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-lg"
              />
              
              {/* Dropdown */}
              {showDropdown && filteredGuests.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
                  {filteredGuests.map((name) => (
                    <button
                      key={name}
                      onClick={() => {
                        setSelectedName(name);
                        setSearchQuery(name);
                        setShowDropdown(false);
                      }}
                      className={`w-full text-left px-5 py-3.5 transition-colors ${
                        selectedName === name
                          ? 'bg-purple-600 text-white'
                          : 'text-white/80 hover:bg-white/10'
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

            {/* Vote Button */}
            <button
              onClick={handleVote}
              disabled={!selectedName || submitting}
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

            <p className="text-center text-zinc-500 text-sm">
              You can only vote once
            </p>
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
            <div className="text-center text-zinc-400">
              {totalVotes} total votes
            </div>

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
                    <div
                      key={entry.name}
                      className="relative bg-white/5 rounded-xl overflow-hidden"
                    >
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
                          <span className={`font-medium ${
                            entry.name === hasVoted ? 'text-purple-300' : 'text-white'
                          }`}>
                            {entry.name}
                            {entry.name === hasVoted && (
                              <span className="ml-2 text-xs text-purple-400">(your vote)</span>
                            )}
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

        {/* Back link */}
        <div className="mt-10 text-center">
          <Link href="/" className="text-zinc-500 hover:text-purple-400 text-sm transition-colors">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
