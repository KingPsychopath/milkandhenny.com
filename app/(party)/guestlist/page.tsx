'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/config';
import { useGuests } from './hooks/useGuests';
import { useGuestSearch } from './hooks/useGuestSearch';
import { SearchBar } from './components/SearchBar';
import { GuestList } from './components/GuestList';
import { GuestStats } from './components/GuestStats';
import { GuestManagement } from './components/GuestManagement';
import { getStored, removeStored, setStored } from '@/lib/client/storage';

/** Loading placeholder — same on server and initial client to avoid hydration mismatch. */
function AuthLoadingPlaceholder() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function GuestListPage() {
  const [mounted, setMounted] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [authTokenSource, setAuthTokenSource] = useState<'staff' | 'admin' | ''>('');
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState<string | false>(false);

  useEffect(() => {
    const initTimer = window.setTimeout(() => {
      const staff = getStored("staffToken") ?? '';
      const admin = getStored("adminToken") ?? '';
      if (staff) {
        setAuthToken(staff);
        setAuthTokenSource('staff');
      } else if (admin) {
        // Admin tokens are a superset of staff permissions for `/api/guests/*`.
        setAuthToken(admin);
        setAuthTokenSource('admin');
      } else {
        setAuthToken('');
        setAuthTokenSource('');
      }
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(initTimer);
  }, []);

  const isAuthenticated = !!authToken;

  const { guests, loading, error, updateCheckIn, refetch } = useGuests(authToken, () => {
    // Expired/revoked tokens should drop back to the auth gate.
    if (authTokenSource === 'staff') removeStored('staffToken');
    if (authTokenSource === 'admin') removeStored('adminToken');
    setAuthToken('');
    setAuthTokenSource('');
    setPinInput('');
    setPinError(false);
  });
  const { searchQuery, setSearchQuery, filter, setFilter, filteredGuests, searchStats } = useGuestSearch(guests);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError(false);
    try {
      const res = await fetch('/api/guests/verify-staff-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setStored("staffToken", data.token);
        setAuthToken(data.token);
        setAuthTokenSource('staff');
      } else {
        setPinError(res.status === 429 ? 'Too many attempts. Try again in 15 minutes.' : 'Incorrect PIN');
        setPinInput('');
      }
    } catch {
      setPinError('Connection error. Check your network and try again.');
      setPinInput('');
    }
  };

  if (!mounted) return <AuthLoadingPlaceholder />;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-stone-900 flex items-center justify-center p-6">
        <main id="main" className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-amber-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Staff Access</h1>
            <p className="text-zinc-400">Enter PIN to access guest list</p>
          </div>

          <form onSubmit={handlePinSubmit} className="space-y-4">
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value.replace(/\D/g, ''));
                setPinError(false);
              }}
              placeholder="••••"
              className={`w-full px-6 py-4 text-center text-3xl font-mono tracking-[0.5em] bg-white/10 border rounded-2xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all ${
                pinError !== false ? 'border-red-500 bg-red-500/10' : 'border-white/20'
              }`}
              autoFocus
            />

            {pinError && <p className="text-red-400 text-center text-sm">{pinError}</p>}

            <button
              type="submit"
              disabled={pinInput.length < 4}
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-zinc-950 font-bold text-lg rounded-2xl transition-all"
            >
              Enter
            </button>
          </form>

          <div className="mt-8 text-center">
            <Link href="/party" className="text-zinc-500 hover:text-amber-400 text-sm transition-colors">
              ← Back to party
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (loading && guests.length === 0) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 relative">
            <div className="absolute inset-0 rounded-full border-4 border-amber-200"></div>
            <div className="absolute inset-0 rounded-full border-4 border-amber-600 border-t-transparent animate-spin"></div>
          </div>
          <p className="text-stone-600 font-medium">Loading guest list...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100">
      <GuestManagement guests={guests} onGuestAdded={refetch} onGuestRemoved={refetch} onCSVImported={refetch} />

      <main id="main" className="max-w-lg mx-auto bg-white min-h-screen shadow-xl shadow-stone-300/50">
        {/* Header */}
        <header className="bg-gradient-to-br from-amber-600 via-amber-500 to-yellow-500 pt-safe">
          <div className="px-5 py-4 flex items-center gap-4">
            {/* M&H Badge */}
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 flex items-center justify-center flex-shrink-0 shadow-lg">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                <span className="text-zinc-900 font-bold text-lg font-serif">M</span>
              </div>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Guest List</h1>
              <p className="text-amber-100 text-sm mt-0.5">Tap to check in guests</p>
            </div>
          </div>
        </header>

        {/* Stats */}
        <GuestStats guests={guests} loading={loading} />

        {/* Search */}
        <SearchBar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filter={filter}
          onFilterChange={setFilter}
          searchStats={searchStats}
        />

        {/* Error banner */}
        {error && (
          <div className="mx-4 mt-4 p-4 bg-red-50 border border-red-200 rounded-xl">
            <p className="text-red-700 text-sm flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              {error}
            </p>
          </div>
        )}

        {/* Empty state */}
        {guests.length === 0 && !loading && (
          <div className="p-8 text-center">
            <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">No guests yet</h3>
            <p className="text-slate-500 mb-6">Import your guest list to get started</p>
            <p className="text-sm text-slate-400">
              Tap <strong>Manage</strong> below to import a CSV
            </p>
          </div>
        )}

        {/* Guest list */}
        <div className="pb-32" role="list" aria-label="Guest list">
          <GuestList guests={filteredGuests} onCheckIn={updateCheckIn} searchQuery={searchQuery} />
        </div>

        {/* Footer */}
        <footer role="contentinfo" className="px-5 py-6 border-t border-stone-200 text-center space-y-1">
          <Link href="/party" className="text-stone-400 hover:text-amber-600 text-sm transition-colors">
            ← Back to party
          </Link>
          <p className="text-stone-300 text-xs">
            © {new Date().getFullYear()} {SITE_NAME}
          </p>
        </footer>
      </main>
    </div>
  );
}

