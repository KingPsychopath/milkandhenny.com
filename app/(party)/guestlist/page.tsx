'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/config';
import { useGuests } from './hooks/useGuests';
import { useGuestSearch } from './hooks/useGuestSearch';
import { SearchBar } from './components/SearchBar';
import { GuestList } from './components/GuestList';
import { GuestStats } from './components/GuestStats';
import { GuestManagement } from './components/GuestManagement';
import { getStored, removeStored, setStored } from '@/lib/client/storage';
import QRCode from 'qrcode';

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
  const [voteCode, setVoteCode] = useState<string | null>(null);
  const [voteCodeExpiry, setVoteCodeExpiry] = useState<string | null>(null);
  const [voteCodeLoading, setVoteCodeLoading] = useState(false);
  const [voteCodeQr, setVoteCodeQr] = useState<string | null>(null);
  const [djQr, setDjQr] = useState<string | null>(null);
  const [showDjQr, setShowDjQr] = useState(false);
  const [voteWindowMinutes, setVoteWindowMinutes] = useState(10);
  const [voteWindowLoading, setVoteWindowLoading] = useState(false);
  const [voteWindowStatus, setVoteWindowStatus] = useState<string | null>(null);
  const [voteWindowOpenUntil, setVoteWindowOpenUntil] = useState<number | null>(null);
  const [sheetCount, setSheetCount] = useState(20);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [codeTtlMinutes, setCodeTtlMinutes] = useState(360);
  const [voteCodeWords, setVoteCodeWords] = useState<1 | 2>(1);
  const [printingSheet, setPrintingSheet] = useState(false);
  const [sheetRows, setSheetRows] = useState<Array<{ code: string; qr: string }>>([]);
  const [sheetExpiresAt, setSheetExpiresAt] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [revokeCodesLoading, setRevokeCodesLoading] = useState(false);

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

  const handleUnauthorized = useCallback(() => {
    // Expired/revoked tokens should drop back to the auth gate.
    if (authTokenSource === 'staff') removeStored('staffToken');
    if (authTokenSource === 'admin') removeStored('adminToken');
    setAuthToken('');
    setAuthTokenSource('');
    setPinInput('');
    setPinError(false);
  }, [authTokenSource]);

  const { guests, loading, error, updateCheckIn, refetch } = useGuests(authToken, handleUnauthorized);
  const { searchQuery, setSearchQuery, filter, setFilter, filteredGuests, searchStats } = useGuestSearch(guests);

  const staffFetch = async (url: string, options: RequestInit = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers as Record<string, string>),
        Authorization: `Bearer ${authToken}`,
      },
    });
  };

  const formatMinutesShort = (minutes: number) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return "";
    if (minutes % 60 === 0) return `${minutes / 60}h`;
    return `${minutes}m`;
  };

  useEffect(() => {
    if (!mounted) return;
    const onAfterPrint = () => {
      setPrintingSheet(false);
    };
    window.addEventListener('afterprint', onAfterPrint);
    return () => window.removeEventListener('afterprint', onAfterPrint);
  }, [mounted]);

  // Update "remaining time" label without refetching (only while open).
  useEffect(() => {
    if (!mounted) return;
    if (!voteWindowOpenUntil) return;
    if (voteWindowOpenUntil * 1000 <= Date.now()) return;
    const t = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [mounted, voteWindowOpenUntil]);

  const isVotingOpen = voteWindowOpenUntil ? voteWindowOpenUntil * 1000 > nowTick : false;
  const votingSecondsRemaining = isVotingOpen && voteWindowOpenUntil
    ? Math.max(0, voteWindowOpenUntil - Math.floor(nowTick / 1000))
    : 0;

  const refreshVotingWindow = async () => {
    if (!authToken) return;
    try {
      const res = await staffFetch('/api/best-dressed/voting/open', { method: 'GET' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setVoteWindowOpenUntil(typeof data.openUntil === 'number' ? data.openUntil : null);
    } catch {
      // ignore
    }
  };

  const handleMintVoteCode = async () => {
    setVoteCodeLoading(true);
    setVoteWindowStatus(null);
    try {
      const res = await staffFetch('/api/best-dressed/codes/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttlMinutes: codeTtlMinutes, words: voteCodeWords }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || 'Failed to mint vote code');
      }
      setVoteCode((data.code as string) || null);
      setVoteCodeExpiry((data.expiresAt as string) || null);

      const code = (data.code as string) || '';
      if (code) {
        const link = `${window.location.origin}/best-dressed?code=${encodeURIComponent(code)}`;
        const qr = await QRCode.toDataURL(link, { margin: 1, width: 220 });
        setVoteCodeQr(qr);
      } else {
        setVoteCodeQr(null);
      }
    } catch (e) {
      setVoteWindowStatus(e instanceof Error ? e.message : 'Failed to mint vote code');
    } finally {
      setVoteCodeLoading(false);
    }
  };

  const handlePrintVoteSheet = async () => {
    if (voteCodeWords === 1 && sheetCount > 50) {
      setVoteWindowStatus('1-word codes collide quickly in large sheets. Switch to 2 words or print 50 or less.');
      return;
    }
    setSheetLoading(true);
    setVoteWindowStatus(null);
    try {
      const res = await staffFetch('/api/best-dressed/codes/mint-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: sheetCount, ttlMinutes: codeTtlMinutes, words: voteCodeWords }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || 'Failed to mint vote codes');
      }
      const codes = Array.isArray(data.codes) ? (data.codes as string[]) : [];
      if (codes.length === 0) {
        throw new Error('No codes minted');
      }

      // Generate QR images client-side, then print in-page (avoids popup blockers).
      const rows = await Promise.all(
        codes.map(async (code) => {
          const link = `${window.location.origin}/best-dressed?code=${encodeURIComponent(code)}`;
          const qr = await QRCode.toDataURL(link, { margin: 1, width: 140 });
          return { code, qr };
        })
      );
      setSheetRows(rows);
      setSheetExpiresAt(typeof data.expiresAt === 'string' ? data.expiresAt : null);
      setPrintingSheet(true);
      requestAnimationFrame(() => window.print());
    } catch (e) {
      setVoteWindowStatus(e instanceof Error ? e.message : 'Failed to print vote sheet');
    } finally {
      setSheetLoading(false);
    }
  };

  const handleRevokeAllVoteCodes = async () => {
    const ok = window.confirm(
      'Revoke ALL minted best dressed codes?\n\nThis will invalidate any printed codes that have not been used yet.'
    );
    if (!ok) return;

    setRevokeCodesLoading(true);
    setVoteWindowStatus(null);
    try {
      const res = await staffFetch('/api/best-dressed/codes/revoke-all', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data.error as string) || 'Failed to revoke codes');

      const deleted = typeof data.deleted === 'number' ? data.deleted : 0;
      setVoteWindowStatus(`Revoked ${deleted} codes.`);
      setVoteCode(null);
      setVoteCodeQr(null);
      setVoteCodeExpiry(null);
    } catch (e) {
      setVoteWindowStatus(e instanceof Error ? e.message : 'Failed to revoke codes');
    } finally {
      setRevokeCodesLoading(false);
    }
  };

  const handleOpenVoting = async (minutes: number) => {
    setVoteWindowLoading(true);
    setVoteWindowStatus(null);
    try {
      const res = await staffFetch('/api/best-dressed/voting/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || 'Failed to open voting');
      }
      setVoteWindowOpenUntil(typeof data.openUntil === 'number' ? data.openUntil : null);
      setVoteWindowStatus(
        minutes > 0 ? `Voting open for ${minutes} minutes.` : 'Voting closed.'
      );
    } catch (e) {
      setVoteWindowStatus(e instanceof Error ? e.message : 'Failed to open voting');
    } finally {
      setVoteWindowLoading(false);
    }
  };

  useEffect(() => {
    // Pre-generate an "event QR" once after mount. It's just a deep link to the voting page.
    if (!mounted) return;
    if (djQr) return;
    const link = `${window.location.origin}/best-dressed`;
    QRCode.toDataURL(link, { margin: 1, width: 260 })
      .then((qr) => setDjQr(qr))
      .catch(() => {
        /* ignore */
      });
  }, [djQr, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (!authToken) return;
    void refreshVotingWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, authToken]);

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
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 12mm;
          }
          body * {
            visibility: hidden;
          }
          #vote-sheet-print,
          #vote-sheet-print * {
            visibility: visible;
          }
          #vote-sheet-print {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .bd-print-grid {
            gap: 10px !important;
          }
          .bd-print-card {
            break-inside: avoid;
            page-break-inside: avoid;
            padding: 10px !important;
          }
          .bd-print-qr {
            width: 140px !important;
            height: 140px !important;
          }
          .bd-print-code {
            margin-top: 6px !important;
            font-size: 13px !important;
          }
        }
      `}</style>

      <div
        id="vote-sheet-print"
        className={printingSheet ? 'p-4 bg-white' : 'hidden'}
        aria-hidden={!printingSheet}
      >
        <div className="font-mono">
          <p className="text-xs text-stone-500">best dressed</p>
          <p className="text-sm font-semibold text-stone-900">vote codes</p>
          <p className="text-[11px] text-stone-500 mt-1">
            ttl {formatMinutesShort(codeTtlMinutes)} {sheetExpiresAt ? `• expires ${new Date(sheetExpiresAt).toLocaleTimeString()}` : ''}
          </p>
        </div>

        <div className="bd-print-grid mt-3 grid grid-cols-3 gap-3">
          {sheetRows.map((r) => (
            <div key={r.code} className="bd-print-card border border-stone-200 rounded-lg p-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={r.qr}
                alt={`QR ${r.code}`}
                className="bd-print-qr w-36 h-36 mx-auto"
                style={{ imageRendering: 'pixelated' }}
              />
              <p className="bd-print-code mt-2 font-mono text-sm tracking-wider text-stone-900">{r.code}</p>
              <p className="mt-1 text-[11px] text-stone-500">scan to vote</p>
            </div>
          ))}
        </div>
      </div>

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

        {/* Best dressed controls (door staff) */}
        <section className="mx-4 mt-4 p-4 bg-stone-50 border border-stone-200 rounded-xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-stone-500">best dressed</p>
              <p className="text-stone-800 font-medium text-sm">vote codes + voting window</p>
            </div>
            <Link href="/best-dressed" className="text-stone-500 hover:text-amber-700 text-sm transition-colors">
              open →
            </Link>
          </div>

          <p className="mt-2 font-mono text-[11px] text-stone-400">tap the buttons; options are optional</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={voteCodeLoading}
              onClick={() => void handleMintVoteCode()}
              className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {voteCodeLoading ? 'minting…' : `mint code (${formatMinutesShort(codeTtlMinutes)})`}
            </button>

            <button
              type="button"
              disabled={sheetLoading}
              onClick={() => void handlePrintVoteSheet()}
              className="px-3 py-2 rounded-lg bg-white border border-stone-200 text-stone-700 text-sm font-medium disabled:opacity-50"
              title="Mints codes and opens the print dialog."
            >
              {sheetLoading ? 'prepping…' : `print sheet (${sheetCount})`}
            </button>

            <button
              type="button"
              disabled={voteWindowLoading}
              onClick={() => void handleOpenVoting(isVotingOpen ? 0 : voteWindowMinutes)}
              className={`px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${
                isVotingOpen ? 'bg-white border border-stone-200 text-stone-800' : 'bg-stone-900 text-white'
              }`}
            >
              {voteWindowLoading
                ? 'updating…'
                : isVotingOpen
                  ? `voting open (${Math.ceil(votingSecondsRemaining / 60)}m left) • tap to close`
                  : `open voting (${voteWindowMinutes}m)`}
            </button>
          </div>

          <details className="mt-3">
            <summary className="cursor-pointer select-none font-mono text-xs text-stone-500">
              options / extras
            </summary>
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={voteCodeWords}
                  onChange={(e) => setVoteCodeWords(Number(e.target.value) === 1 ? 1 : 2)}
                  className="px-3 py-2 rounded-lg bg-white border border-stone-200 text-sm"
                  aria-label="Vote code word count"
                  title="How many words a minted vote code has."
                >
                  <option value={2}>code 2 words</option>
                  <option value={1}>code 1 word</option>
                </select>

                <select
                  value={codeTtlMinutes}
                  onChange={(e) => setCodeTtlMinutes(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg bg-white border border-stone-200 text-sm"
                  aria-label="Vote code TTL"
                  title="How long minted codes remain valid."
                >
                  <option value={60}>ttl 1h</option>
                  <option value={180}>ttl 3h</option>
                  <option value={360}>ttl 6h</option>
                  <option value={720}>ttl 12h</option>
                </select>

                <select
                  value={sheetCount}
                  onChange={(e) => setSheetCount(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg bg-white border border-stone-200 text-sm"
                  aria-label="Vote sheet count"
                >
                  <option value={10}>sheet 10</option>
                  <option value={20}>sheet 20</option>
                  <option value={30}>sheet 30</option>
                  <option value={50}>sheet 50</option>
                </select>

                <select
                  value={voteWindowMinutes}
                  onChange={(e) => setVoteWindowMinutes(Number(e.target.value))}
                  className="px-3 py-2 rounded-lg bg-white border border-stone-200 text-sm"
                  aria-label="Voting window minutes"
                >
                  <option value={5}>window 5m</option>
                  <option value={10}>window 10m</option>
                  <option value={15}>window 15m</option>
                  <option value={30}>window 30m</option>
                </select>

                <button
                  type="button"
                  onClick={() => setShowDjQr((v) => !v)}
                  className="px-3 py-2 rounded-lg bg-white border border-stone-200 text-stone-700 text-sm font-medium"
                  title="For posters / powerpoint: QR that opens the voting page (no code). Best paired with open voting window."
                >
                  {showDjQr ? 'hide event qr' : 'show event qr'}
                </button>

                <button
                  type="button"
                  disabled={revokeCodesLoading}
                  onClick={() => void handleRevokeAllVoteCodes()}
                  className="px-3 py-2 rounded-lg bg-white border border-red-200 text-red-700 text-sm font-medium disabled:opacity-50"
                  title="Deletes all currently minted vote codes from Redis."
                >
                  {revokeCodesLoading ? 'revoking…' : 'revoke all codes'}
                </button>
              </div>

              {voteCodeWords === 1 ? (
                <p className="font-mono text-[11px] text-stone-400">
                  1-word sheets are capped at 50 to avoid collisions
                </p>
              ) : null}
            </div>
          </details>

          {voteCode ? (
            <div className="mt-3 p-3 rounded-lg bg-white border border-stone-200">
              <p className="text-stone-500 text-xs">latest code</p>
              <p className="font-mono text-lg tracking-wider text-stone-900">{voteCode}</p>
              {voteCodeExpiry ? (
                <p className="text-stone-400 text-xs mt-1">expires {new Date(voteCodeExpiry).toLocaleTimeString()}</p>
              ) : null}
              {voteCodeQr ? (
                <div className="mt-3 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={voteCodeQr}
                    alt="Best dressed vote QR"
                    className="w-36 h-36 rounded-lg border border-stone-200"
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {showDjQr && djQr ? (
            <div className="mt-3 p-3 rounded-lg bg-white border border-stone-200">
              <p className="text-stone-500 text-xs">event qr</p>
              <p className="text-stone-400 text-xs mt-1">scan to open voting page (no code)</p>
              <div className="mt-3 flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={djQr}
                  alt="Best dressed event QR"
                  className="w-44 h-44 rounded-lg border border-stone-200"
                />
              </div>
            </div>
          ) : null}

          {voteWindowStatus ? (
            <p className="mt-2 text-stone-500 text-xs">{voteWindowStatus}</p>
          ) : null}
        </section>

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

