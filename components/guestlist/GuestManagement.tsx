'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { Guest } from '@/lib/guests/types';
import { useFocusTrap } from '@/hooks/useFocusTrap';

type LeaderboardEntry = { name: string; count: number };

type GuestManagementProps = {
  guests: Guest[];
  onGuestAdded: () => void;
  onGuestRemoved: () => void;
  onCSVImported: () => void;
};

/** Typeahead input component */
function TypeaheadInput({
  value,
  onChange,
  suggestions,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder: string;
  label: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filteredSuggestions = useMemo(() => {
    if (!value.trim()) return suggestions.slice(0, 10);
    const query = value.toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(query)).slice(0, 10);
  }, [value, suggestions]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(i => Math.min(i + 1, filteredSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault();
      onChange(filteredSuggestions[highlightedIndex]);
      setIsOpen(false);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-stone-700 mb-1.5">{label}</label>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
        role="combobox"
        aria-expanded={isOpen}
        aria-autocomplete="list"
      />
      {isOpen && filteredSuggestions.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-20 w-full mt-1 bg-white border border-stone-200 rounded-xl shadow-lg max-h-48 overflow-y-auto"
          role="listbox"
        >
          {filteredSuggestions.map((suggestion, index) => (
            <li
              key={suggestion}
              className={`px-4 py-2.5 cursor-pointer transition-colors ${
                index === highlightedIndex ? 'bg-amber-50 text-amber-900' : 'hover:bg-stone-50'
              }`}
              onClick={() => {
                onChange(suggestion);
                setIsOpen(false);
              }}
              role="option"
              aria-selected={index === highlightedIndex}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GuestManagement({ guests, onGuestAdded, onGuestRemoved, onCSVImported }: GuestManagementProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  /** User-typed password after successful verify (for API headers). Not the env value. */
  const managementPasswordRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<'add' | 'remove' | 'import' | 'data' | 'games'>('add');
  const [dataLoading, setDataLoading] = useState(false);

  // Games/Best Dressed state
  const [bestDressedLeaderboard, setBestDressedLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [bestDressedTotalVotes, setBestDressedTotalVotes] = useState(0);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [name, setName] = useState('');
  const [fullName, setFullName] = useState('');
  const [plusOneOf, setPlusOneOf] = useState('');
  const [removeSearch, setRemoveSearch] = useState('');
  const [removeId, setRemoveId] = useState('');
  
  const [uploading, setUploading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen);

  // Close modal on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // Get all main guest names for typeahead
  const mainGuestNames = useMemo(() => 
    guests.filter(g => !g.isPlusOne).map(g => g.name).sort(),
    [guests]
  );

  // Get all guests flat for removal
  const allGuestsFlat = useMemo(() => {
    const flat: Array<{ id: string; name: string; displayName: string }> = [];
    guests.forEach((g) => {
      flat.push({ id: g.id, name: g.name, displayName: g.name });
      if (g.plusOnes) {
        g.plusOnes.forEach((p) => {
          flat.push({ id: p.id, name: p.name, displayName: `${p.name} (guest of ${g.name})` });
        });
      }
    });
    return flat.sort((a, b) => a.name.localeCompare(b.name));
  }, [guests]);

  // Filtered guests for removal
  const filteredForRemoval = useMemo(() => {
    if (!removeSearch.trim()) return allGuestsFlat.slice(0, 20);
    const query = removeSearch.toLowerCase();
    return allGuestsFlat.filter(g => g.name.toLowerCase().includes(query));
  }, [allGuestsFlat, removeSearch]);

  // Fetch best dressed data when games tab is active
  useEffect(() => {
    if (activeTab === 'games' && isAuthenticated) {
      fetchBestDressedData();
    }
  }, [activeTab, isAuthenticated]);

  const fetchBestDressedData = async () => {
    try {
      const res = await fetch('/api/best-dressed');
      const data = await res.json();
      setBestDressedLeaderboard(data.leaderboard || []);
      setBestDressedTotalVotes(data.totalVotes || 0);
    } catch (err) {
      console.error('Failed to fetch best dressed data:', err);
    }
  };

  const handleWipeBestDressed = async () => {
    if (!confirm('⚠️ This will delete ALL best dressed votes. Are you sure?')) return;
    
    setGamesLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/best-dressed', {
        method: 'DELETE',
        headers: { 'X-Management-Password': managementPasswordRef.current ?? '' },
      });
      if (res.ok) {
        setBestDressedLeaderboard([]);
        setBestDressedTotalVotes(0);
        setSuccess('Best dressed votes cleared');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError('Failed to clear votes');
      }
    } catch {
      setError('Failed to clear votes');
    } finally {
      setGamesLoading(false);
    }
  };

  const handlePartyReset = async () => {
    if (!confirm('🎉 PARTY RESET\n\nThis will:\n• Reset guest list from CSV (clears all check-ins)\n• Clear all Best Dressed votes\n\nThis prepares a fresh state for the party. Continue?')) return;
    
    setDataLoading(true);
    setError(null);
    
    try {
      // Reset guests from CSV
      const guestRes = await fetch('/api/guests/bootstrap', {
        method: 'DELETE',
        headers: { 'X-Management-Password': managementPasswordRef.current ?? '' },
      });
      const guestData = await guestRes.json();
      
      // Clear best dressed votes
      await fetch('/api/best-dressed', {
        method: 'DELETE',
        headers: { 'X-Management-Password': managementPasswordRef.current ?? '' },
      });
      setBestDressedLeaderboard([]);
      setBestDressedTotalVotes(0);
      
      setSuccess(`🎉 Party ready! Loaded ${guestData.count} guests, all votes cleared.`);
      setTimeout(() => setSuccess(null), 5000);
      onCSVImported();
    } catch {
      setError('Party reset failed');
    } finally {
      setDataLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(false);
    try {
      const res = await fetch('/api/guests/verify-management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        managementPasswordRef.current = password;
        setIsAuthenticated(true);
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch('/api/guests/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Management-Password': managementPasswordRef.current ?? '',
        },
        body: JSON.stringify({ name, fullName, plusOneOf: plusOneOf || undefined }),
      });
      if (res.ok) {
        setName('');
        setFullName('');
        setPlusOneOf('');
        setSuccess('Guest added successfully!');
        setTimeout(() => setSuccess(null), 2000);
        onGuestAdded();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add guest');
      }
    } catch {
      setError('Failed to add guest');
    }
  };

  const handleRemove = async () => {
    if (!removeId) return;
    setError(null);
    try {
      const res = await fetch(`/api/guests/remove?id=${encodeURIComponent(removeId)}`, {
        method: 'DELETE',
        headers: { 'X-Management-Password': managementPasswordRef.current ?? '' },
      });
      if (res.ok) {
        setRemoveId('');
        setRemoveSearch('');
        setSuccess('Guest removed successfully!');
        setTimeout(() => setSuccess(null), 2000);
        onGuestRemoved();
      } else {
        setError('Failed to remove guest');
      }
    } catch {
      setError('Failed to remove guest');
    }
  };

  const handleBootstrap = async () => {
    setDataLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/guests/bootstrap', {
        method: 'POST',
        headers: { 'X-Management-Password': managementPasswordRef.current ?? '' },
      });
      const data = await res.json();
      if (data.bootstrapped) {
        setSuccess(`Loaded ${data.count} guests from CSV`);
      } else {
        setSuccess(data.message || 'Guests already exist');
      }
      setTimeout(() => setSuccess(null), 3000);
      onCSVImported();
    } catch {
      setError('Failed to bootstrap');
    } finally {
      setDataLoading(false);
    }
  };

  const handleForceReload = async () => {
    if (!confirm('⚠️ WARNING: This will DELETE all check-ins and reload from CSV. Are you sure?')) {
      return;
    }
    setDataLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/guests/bootstrap', {
        method: 'DELETE',
        headers: { 'X-Management-Password': managementPasswordRef.current ?? '' },
      });
      const data = await res.json();
      setSuccess(`Reset complete! Loaded ${data.count} guests from CSV`);
      setTimeout(() => setSuccess(null), 3000);
      onCSVImported();
    } catch {
      setError('Failed to reload data');
    } finally {
      setDataLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

      const res = await fetch('/api/guests/import', {
        method: 'POST',
        headers: { 'X-Management-Password': managementPasswordRef.current ?? '' },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to import CSV');
      }

      const data = await res.json();
      setSuccess(`Imported ${data.count} guests!`);
      setTimeout(() => setSuccess(null), 3000);
      onCSVImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const closeModal = () => {
    setIsOpen(false);
    setIsAuthenticated(false);
    setPassword('');
    setPasswordError(false);
    setError(null);
    setSuccess(null);
  };

  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-20">
        <button
          onClick={() => setIsOpen(true)}
          className="bg-gradient-to-r from-amber-600 to-yellow-500 text-white px-5 py-3 rounded-2xl shadow-lg shadow-amber-300/50 hover:shadow-xl hover:shadow-amber-300/50 transition-all flex items-center gap-2 font-medium"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Manage
        </button>
      </div>
    );
  }

  return (
    <div
      ref={modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Manage Guests"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
      onKeyDown={undefined}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-gradient-to-r from-amber-600 to-yellow-500">
          <h2 className="text-lg font-semibold text-white">Manage Guests</h2>
          <button
            onClick={closeModal}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Password gate */}
          {!isAuthenticated ? (
            <form onSubmit={handlePasswordSubmit} className="p-6 space-y-4">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <p className="text-stone-600">Enter password to manage guests</p>
              </div>
              
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(false);
                }}
                placeholder="Password"
                className={`w-full px-4 py-3 bg-stone-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all ${
                  passwordError ? 'border-red-300 bg-red-50' : 'border-stone-200'
                }`}
                autoFocus
              />
              
              {passwordError && (
                <p className="text-red-600 text-sm text-center">Incorrect password</p>
              )}
              
              <button
                type="submit"
                className="w-full bg-amber-600 text-white py-3 rounded-xl font-medium hover:bg-amber-700 transition-colors"
              >
                Unlock
              </button>
            </form>
          ) : (
            <div className="p-6 space-y-5">
              {/* Tabs */}
              <div className="flex gap-1 bg-stone-100 p-1 rounded-xl">
                {(['add', 'remove', 'import', 'data', 'games'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                      activeTab === tab
                        ? 'bg-white text-amber-700 shadow-sm'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {tab === 'add' && 'Add'}
                    {tab === 'remove' && 'Remove'}
                    {tab === 'import' && 'Import'}
                    {tab === 'data' && 'Data'}
                    {tab === 'games' && '🎮'}
                  </button>
                ))}
              </div>

              {/* Success/Error messages */}
              {success && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {success}
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {error}
                </div>
              )}

              {/* Add Guest Tab */}
              {activeTab === 'add' && (
                <form onSubmit={handleAdd} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1.5">Name *</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder="Enter guest name"
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1.5">Full Name (optional)</label>
                    <input
                      type="text"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Full legal name if different"
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
                    />
                  </div>

                  <TypeaheadInput
                    value={plusOneOf}
                    onChange={setPlusOneOf}
                    suggestions={mainGuestNames}
                    placeholder="Leave empty for main guest"
                    label="Guest of (for +1s)"
                  />
                  
                  <button
                    type="submit"
                    className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Add Guest
                  </button>
                </form>
              )}

              {/* Remove Guest Tab */}
              {activeTab === 'remove' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1.5">Search guest to remove</label>
                    <input
                      type="text"
                      value={removeSearch}
                      onChange={(e) => {
                        setRemoveSearch(e.target.value);
                        setRemoveId('');
                      }}
                      placeholder="Type to search..."
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                    />
                  </div>

                  {filteredForRemoval.length > 0 && (
                    <div className="border border-stone-200 rounded-xl max-h-48 overflow-y-auto">
                      {filteredForRemoval.map((guest) => (
                        <button
                          key={guest.id}
                          onClick={() => setRemoveId(guest.id)}
                          className={`w-full text-left px-4 py-3 border-b border-stone-100 last:border-b-0 transition-colors ${
                            removeId === guest.id
                              ? 'bg-red-50 text-red-700'
                              : 'hover:bg-stone-50'
                          }`}
                        >
                          {guest.displayName}
                        </button>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={handleRemove}
                    disabled={!removeId}
                    className="w-full bg-red-600 text-white py-3 rounded-xl font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Remove Selected
                  </button>
                </div>
              )}

              {/* Import CSV Tab */}
              {activeTab === 'import' && (
                <div className="space-y-4">
                  <div className="bg-stone-50 border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center">
                    <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    
                    <p className="text-stone-600 mb-4">
                      Upload your Partiful CSV export
                    </p>
                    
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="hidden"
                      id="csv-upload"
                    />
                    
                    <label
                      htmlFor="csv-upload"
                      className={`inline-flex items-center gap-2 bg-amber-600 text-white px-6 py-3 rounded-xl font-medium cursor-pointer hover:bg-amber-700 transition-colors ${
                        uploading ? 'opacity-50 cursor-not-allowed' : ''
                      }`}
                    >
                      {uploading ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          Select CSV File
                        </>
                      )}
                    </label>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm text-amber-800">
                      <strong>Note:</strong> Uploading a new CSV will <strong>replace all data</strong> including check-ins.
                    </p>
                  </div>
                </div>
              )}

              {/* Data Management Tab */}
              {activeTab === 'data' && (
                <div className="space-y-4">
                  {/* Party Reset - Big CTA */}
                  <button
                    onClick={handlePartyReset}
                    disabled={dataLoading}
                    className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold text-lg rounded-2xl shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                  >
                    {dataLoading ? (
                      <div className="w-6 h-6 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" />
                    ) : (
                      <>
                        <span className="text-2xl">🎉</span>
                        Party Reset
                      </>
                    )}
                  </button>
                  <p className="text-center text-stone-500 text-xs">
                    Resets check-ins + clears votes in one click
                  </p>

                  {/* Current Stats */}
                  <div className="bg-stone-50 rounded-xl p-4 mt-4">
                    <h3 className="font-medium text-stone-700 mb-2">Current Data</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-white rounded-lg p-3 border border-stone-200">
                        <div className="text-2xl font-bold text-amber-600">{guests.length}</div>
                        <div className="text-stone-500">Primary Guests</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-stone-200">
                        <div className="text-2xl font-bold text-amber-600">
                          {guests.reduce((acc, g) => acc + (g.plusOnes?.length || 0), 0)}
                        </div>
                        <div className="text-stone-500">Plus Ones</div>
                      </div>
                    </div>
                  </div>

                  {/* Bootstrap Button - Safe */}
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                    <div>
                      <h4 className="font-medium text-emerald-800">Load from CSV (Safe)</h4>
                      <p className="text-sm text-emerald-700 mt-1">
                        Only loads if database is empty. <strong>Preserves existing check-ins.</strong>
                      </p>
                    </div>
                    <button
                      onClick={handleBootstrap}
                      disabled={dataLoading}
                      className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                      {dataLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                      )}
                      Bootstrap from CSV
                    </button>
                  </div>

                  {/* Force Reload Button - Dangerous */}
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                    <div>
                      <h4 className="font-medium text-red-800">⚠️ Force Reload (Destructive)</h4>
                      <p className="text-sm text-red-700 mt-1">
                        Clears ALL data including check-ins and reloads fresh from CSV.
                      </p>
                    </div>
                    <button
                      onClick={handleForceReload}
                      disabled={dataLoading}
                      className="w-full bg-red-600 text-white py-2.5 rounded-xl font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                      {dataLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      Reset &amp; Reload from CSV
                    </button>
                  </div>

                  {/* Info */}
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-800">
                      <strong>How check-ins persist:</strong> All check-ins are saved to Redis immediately. 
                      They persist across page refreshes and device switches. Only a Force Reload or new CSV import will clear them.
                    </p>
                  </div>
                </div>
              )}

              {/* Games Tab */}
              {activeTab === 'games' && (
                <div className="space-y-4">
                  {/* Best Dressed Stats */}
                  <div className="bg-gradient-to-r from-pink-50 to-purple-50 border border-purple-200 rounded-xl p-4">
                    <h3 className="font-medium text-purple-800 mb-3 flex items-center gap-2">
                      <span>👑</span> Best Dressed
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-white rounded-lg p-3 border border-purple-100">
                        <div className="text-2xl font-bold text-purple-600">{bestDressedTotalVotes}</div>
                        <div className="text-purple-500 text-sm">Total Votes</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-purple-100">
                        <div className="text-2xl font-bold text-purple-600">{bestDressedLeaderboard.length}</div>
                        <div className="text-purple-500 text-sm">Nominees</div>
                      </div>
                    </div>

                    {/* Mini Leaderboard */}
                    {bestDressedLeaderboard.length > 0 && (
                      <div className="bg-white rounded-lg border border-purple-100 overflow-hidden mb-4">
                        <div className="px-3 py-2 bg-purple-50 text-xs font-medium text-purple-600">
                          Top 5
                        </div>
                        {bestDressedLeaderboard.slice(0, 5).map((entry, i) => (
                          <div key={entry.name} className="px-3 py-2 flex justify-between items-center border-t border-purple-50">
                            <span className="text-sm">
                              {i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`} {entry.name}
                            </span>
                            <span className="text-sm font-medium text-purple-600">{entry.count}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Refresh button */}
                    <button
                      onClick={fetchBestDressedData}
                      className="w-full py-2 text-sm text-purple-600 hover:text-purple-800 transition-colors"
                    >
                      ↻ Refresh
                    </button>
                  </div>

                  {/* Wipe Best Dressed */}
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                    <div>
                      <h4 className="font-medium text-red-800">⚠️ Clear Best Dressed Votes</h4>
                      <p className="text-sm text-red-700 mt-1">
                        Permanently deletes all votes. Cannot be undone.
                      </p>
                    </div>
                    <button
                      onClick={handleWipeBestDressed}
                      disabled={gamesLoading}
                      className="w-full bg-red-600 text-white py-2.5 rounded-xl font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                    >
                      {gamesLoading ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      )}
                      Clear All Votes
                    </button>
                  </div>

                  {/* Info */}
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-800">
                      <strong>Testing tip:</strong> To re-test voting from your own device, clear your browser&apos;s localStorage 
                      (Developer Tools → Application → Local Storage → Clear).
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
