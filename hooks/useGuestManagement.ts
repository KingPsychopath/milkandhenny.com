'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import type { Guest } from '@/lib/guests/types';
import { useFocusTrap } from '@/hooks/useFocusTrap';

type LeaderboardEntry = { name: string; count: number };

type GuestManagementInput = {
  guests: Guest[];
  onGuestAdded: () => void;
  onGuestRemoved: () => void;
  onCSVImported: () => void;
};

/**
 * Encapsulates all state and API logic for the guest management modal.
 * The component becomes pure UI rendering.
 */
export function useGuestManagement({
  guests,
  onGuestAdded,
  onGuestRemoved,
  onCSVImported,
}: GuestManagementInput) {
  /* ─── Modal ─── */
  const [isOpen, setIsOpen] = useState(false);
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen);

  /* ─── Auth ─── */
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | false>(false);
  const adminTokenRef = useRef<string | null>(null);

  /* ─── Tabs ─── */
  const [activeTab, setActiveTab] = useState<'add' | 'remove' | 'import' | 'data' | 'games'>('add');

  /* ─── Shared feedback ─── */
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ─── Add tab ─── */
  const [name, setName] = useState('');
  const [fullName, setFullName] = useState('');
  const [plusOneOf, setPlusOneOf] = useState('');

  /* ─── Remove tab ─── */
  const [removeSearch, setRemoveSearch] = useState('');
  const [removeId, setRemoveId] = useState('');

  /* ─── Import tab ─── */
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ─── Data tab ─── */
  const [dataLoading, setDataLoading] = useState(false);

  /* ─── Games tab ─── */
  const [bestDressedLeaderboard, setBestDressedLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [bestDressedTotalVotes, setBestDressedTotalVotes] = useState(0);
  const [gamesLoading, setGamesLoading] = useState(false);

  /* ─── Computed ─── */

  const mainGuestNames = useMemo(
    () => guests.filter((g) => !g.isPlusOne).map((g) => g.name).sort(),
    [guests]
  );

  const allGuestsFlat = useMemo(() => {
    const flat: Array<{ id: string; name: string; displayName: string }> = [];
    const seen = new Set<string>();
    guests.forEach((g) => {
      if (!seen.has(g.id)) {
        seen.add(g.id);
        flat.push({ id: g.id, name: g.name, displayName: g.name });
      }
      g.plusOnes?.forEach((p) => {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          flat.push({ id: p.id, name: p.name, displayName: `${p.name} (guest of ${g.name})` });
        }
      });
    });
    return flat.sort((a, b) => a.name.localeCompare(b.name));
  }, [guests]);

  const filteredForRemoval = useMemo(() => {
    if (!removeSearch.trim()) return allGuestsFlat.slice(0, 20);
    const query = removeSearch.toLowerCase();
    return allGuestsFlat.filter((g) => g.name.toLowerCase().includes(query));
  }, [allGuestsFlat, removeSearch]);

  /* ─── Helpers ─── */

  /** Fetch with the management Bearer token pre-attached. */
  const authFetch = useCallback(
    (url: string, opts: RequestInit = {}) =>
      fetch(url, {
        ...opts,
        headers: {
          ...(opts.headers as Record<string, string>),
          Authorization: `Bearer ${adminTokenRef.current ?? ''}`,
        },
      }),
    []
  );

  function flashSuccess(msg: string, ms = 3000) {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), ms);
  }

  /* ─── Effects ─── */

  useEffect(() => {
    if (!isOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (activeTab === 'games' && isAuthenticated) {
      fetchBestDressedData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isAuthenticated]);

  /* ─── Handlers ─── */

  function openModal() {
    setIsOpen(true);
  }

  function closeModal() {
    setIsOpen(false);
    setIsAuthenticated(false);
    setPassword('');
    setPasswordError(false);
    setError(null);
    setSuccess(null);
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(false);
    const trimmedPassword = password.trim();
    try {
      const res = await fetch('/api/guests/verify-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: trimmedPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        adminTokenRef.current = data.token;
        setIsAuthenticated(true);
      } else {
        setPasswordError(
          res.status === 429
            ? 'Too many attempts. Please try again in 15 minutes.'
            : (data.error as string) || 'Incorrect password'
        );
      }
    } catch {
      setPasswordError('Connection error. Please try again.');
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await authFetch('/api/guests/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, fullName, plusOneOf: plusOneOf || undefined }),
      });
      if (res.ok) {
        setName('');
        setFullName('');
        setPlusOneOf('');
        flashSuccess('Guest added successfully!', 2000);
        onGuestAdded();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add guest');
      }
    } catch {
      setError('Connection error. Could not add guest.');
    }
  }

  async function handleRemove() {
    if (!removeId) return;
    setError(null);
    try {
      const res = await authFetch(`/api/guests/remove?id=${encodeURIComponent(removeId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRemoveId('');
        setRemoveSearch('');
        flashSuccess('Guest removed successfully!', 2000);
        onGuestRemoved();
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data.error as string) || 'Failed to remove guest');
      }
    } catch {
      setError('Connection error. Could not remove guest.');
    }
  }

  async function handleBootstrap() {
    setDataLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/guests/bootstrap', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data.error as string) || 'Bootstrap failed');
        return;
      }
      flashSuccess(data.bootstrapped ? `Loaded ${data.count} guests from CSV` : (data.message || 'Guests already exist'));
      onCSVImported();
    } catch {
      setError('Connection error. Could not bootstrap.');
    } finally {
      setDataLoading(false);
    }
  }

  async function handleForceReload() {
    if (!confirm('WARNING: This will DELETE all check-ins and reload from CSV. Are you sure?')) return;
    setDataLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/guests/bootstrap', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data.error as string) || 'Force reload failed');
        return;
      }
      flashSuccess(`Reset complete! Loaded ${data.count} guests from CSV`);
      onCSVImported();
    } catch {
      setError('Connection error. Could not reload data.');
    } finally {
      setDataLoading(false);
    }
  }

  async function handlePartyReset() {
    if (!confirm('PARTY RESET\n\nThis will:\n- Reset guest list from CSV (clears all check-ins)\n- Clear all Best Dressed votes\n\nThis prepares a fresh state for the party. Continue?')) return;
    setDataLoading(true);
    setError(null);
    try {
      const guestRes = await authFetch('/api/guests/bootstrap', { method: 'DELETE' });
      const guestData = await guestRes.json().catch(() => ({}));
      if (!guestRes.ok) {
        setError((guestData.error as string) || 'Guest reset failed');
        return;
      }

      const voteRes = await authFetch('/api/best-dressed', { method: 'DELETE' });
      if (!voteRes.ok) {
        setError('Guests reset but failed to clear votes');
        onCSVImported();
        return;
      }

      setBestDressedLeaderboard([]);
      setBestDressedTotalVotes(0);
      flashSuccess(`Party ready! Loaded ${guestData.count} guests, all votes cleared.`, 5000);
      onCSVImported();
    } catch {
      setError('Connection error. Party reset incomplete.');
    } finally {
      setDataLoading(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      setError('Please upload a CSV file');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/guests/import', { method: 'POST', body: formData });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to import CSV');
      }
      const data = await res.json();
      flashSuccess(`Imported ${data.count} guests!`);
      onCSVImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function fetchBestDressedData() {
    try {
      const res = await fetch('/api/best-dressed');
      const data = await res.json();
      setBestDressedLeaderboard(data.leaderboard || []);
      setBestDressedTotalVotes(data.totalVotes || 0);
    } catch (err) {
      console.error('Failed to fetch best dressed data:', err);
    }
  }

  async function handleWipeBestDressed() {
    if (!confirm('This will delete ALL best dressed votes. Are you sure?')) return;
    setGamesLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/best-dressed', { method: 'DELETE' });
      if (res.ok) {
        setBestDressedLeaderboard([]);
        setBestDressedTotalVotes(0);
        flashSuccess('Best dressed votes cleared');
      } else {
        const data = await res.json().catch(() => ({}));
        setError((data.error as string) || 'Failed to clear votes');
      }
    } catch {
      setError('Connection error. Could not clear votes.');
    } finally {
      setGamesLoading(false);
    }
  }

  return {
    // Modal
    isOpen, openModal, closeModal, modalRef,
    // Auth
    isAuthenticated, password, passwordError,
    setPassword, setPasswordError, handlePasswordSubmit,
    // Tabs
    activeTab, setActiveTab,
    // Feedback
    success, error,
    // Add
    name, fullName, plusOneOf,
    setName, setFullName, setPlusOneOf,
    handleAdd, mainGuestNames,
    // Remove
    removeSearch, removeId,
    setRemoveSearch, setRemoveId,
    handleRemove, filteredForRemoval,
    // Import
    uploading, fileInputRef, handleFileUpload,
    // Data
    dataLoading, handleBootstrap, handleForceReload, handlePartyReset,
    // Games
    bestDressedLeaderboard, bestDressedTotalVotes,
    gamesLoading, fetchBestDressedData, handleWipeBestDressed,
  };
}
