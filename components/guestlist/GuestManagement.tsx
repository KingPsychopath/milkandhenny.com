'use client';

import { Guest } from '@/lib/guests/types';
import { useGuestManagement } from '@/hooks/useGuestManagement';
import { TypeaheadInput } from './TypeaheadInput';

type GuestManagementProps = {
  guests: Guest[];
  onGuestAdded: () => void;
  onGuestRemoved: () => void;
  onCSVImported: () => void;
};

export function GuestManagement({ guests, onGuestAdded, onGuestRemoved, onCSVImported }: GuestManagementProps) {
  const m = useGuestManagement({ guests, onGuestAdded, onGuestRemoved, onCSVImported });

  if (!m.isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-20">
        <button
          onClick={m.openModal}
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
      ref={m.modalRef}
      role="dialog"
      aria-modal="true"
      aria-label="Manage Guests"
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) m.closeModal(); }}
      onKeyDown={undefined}
    >
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-md max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom duration-300">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex justify-between items-center bg-gradient-to-r from-amber-600 to-yellow-500">
          <h2 className="text-lg font-semibold text-white">Manage Guests</h2>
          <button
            onClick={m.closeModal}
            className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(90vh-80px)]">
          {/* Password gate */}
          {!m.isAuthenticated ? (
            <form onSubmit={m.handlePasswordSubmit} className="p-6 space-y-4">
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
                value={m.password}
                onChange={(e) => { m.setPassword(e.target.value); m.setPasswordError(false); }}
                placeholder="Password"
                className={`w-full px-4 py-3 bg-stone-50 border rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all ${
                  m.passwordError ? 'border-red-300 bg-red-50' : 'border-stone-200'
                }`}
                autoFocus
              />
              {m.passwordError && (
                <p className="text-red-600 text-sm text-center">{m.passwordError}</p>
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
                    onClick={() => m.setActiveTab(tab)}
                    className={`flex-1 py-2 px-1 rounded-lg text-xs font-medium transition-all ${
                      m.activeTab === tab
                        ? 'bg-white text-amber-700 shadow-sm'
                        : 'text-stone-600 hover:text-stone-900'
                    }`}
                  >
                    {tab === 'add' && 'Add'}
                    {tab === 'remove' && 'Remove'}
                    {tab === 'import' && 'Import'}
                    {tab === 'data' && 'Data'}
                    {tab === 'games' && 'Games'}
                  </button>
                ))}
              </div>

              {/* Feedback */}
              {m.success && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {m.success}
                </div>
              )}
              {m.error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  {m.error}
                </div>
              )}

              {/* ── Add tab ── */}
              {m.activeTab === 'add' && (
                <form onSubmit={m.handleAdd} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1.5">Name *</label>
                    <input type="text" value={m.name} onChange={(e) => m.setName(e.target.value)} required placeholder="Enter guest name" className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1.5">Full Name (optional)</label>
                    <input type="text" value={m.fullName} onChange={(e) => m.setFullName(e.target.value)} placeholder="Full legal name if different" className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all" />
                  </div>
                  <TypeaheadInput value={m.plusOneOf} onChange={m.setPlusOneOf} suggestions={m.mainGuestNames} placeholder="Leave empty for main guest" label="Guest of (for +1s)" />
                  <button type="submit" className="w-full bg-emerald-600 text-white py-3 rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                    Add Guest
                  </button>
                </form>
              )}

              {/* ── Remove tab ── */}
              {m.activeTab === 'remove' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1.5">Search guest to remove</label>
                    <input type="text" value={m.removeSearch} onChange={(e) => { m.setRemoveSearch(e.target.value); m.setRemoveId(''); }} placeholder="Type to search..." className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all" />
                  </div>
                  {m.filteredForRemoval.length > 0 && (
                    <div className="border border-stone-200 rounded-xl max-h-48 overflow-y-auto">
                      {m.filteredForRemoval.map((guest) => (
                        <button key={guest.id} onClick={() => m.setRemoveId(guest.id)} className={`w-full text-left px-4 py-3 border-b border-stone-100 last:border-b-0 transition-colors ${m.removeId === guest.id ? 'bg-red-50 text-red-700' : 'hover:bg-stone-50'}`}>
                          {guest.displayName}
                        </button>
                      ))}
                    </div>
                  )}
                  <button onClick={m.handleRemove} disabled={!m.removeId} className="w-full bg-red-600 text-white py-3 rounded-xl font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    Remove Selected
                  </button>
                </div>
              )}

              {/* ── Import tab ── */}
              {m.activeTab === 'import' && (
                <div className="space-y-4">
                  <div className="bg-stone-50 border-2 border-dashed border-stone-200 rounded-2xl p-8 text-center">
                    <div className="w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    </div>
                    <p className="text-stone-600 mb-4">Upload your Partiful CSV export</p>
                    <input ref={m.fileInputRef} type="file" accept=".csv" onChange={m.handleFileUpload} disabled={m.uploading} className="hidden" id="csv-upload" />
                    <label htmlFor="csv-upload" className={`inline-flex items-center gap-2 bg-amber-600 text-white px-6 py-3 rounded-xl font-medium cursor-pointer hover:bg-amber-700 transition-colors ${m.uploading ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      {m.uploading ? (
                        <><div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />Uploading...</>
                      ) : (
                        <><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>Select CSV File</>
                      )}
                    </label>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm text-amber-800"><strong>Note:</strong> Uploading a new CSV will <strong>replace all data</strong> including check-ins.</p>
                  </div>
                </div>
              )}

              {/* ── Data tab ── */}
              {m.activeTab === 'data' && (
                <div className="space-y-4">
                  <button onClick={m.handlePartyReset} disabled={m.dataLoading} className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold text-lg rounded-2xl shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 disabled:opacity-50 transition-all flex items-center justify-center gap-3">
                    {m.dataLoading ? <div className="w-6 h-6 border-2 border-zinc-950/30 border-t-zinc-950 rounded-full animate-spin" /> : <><span className="text-2xl">*</span>Party Reset</>}
                  </button>
                  <p className="text-center text-stone-500 text-xs">Resets check-ins + clears votes in one click</p>

                  <div className="bg-stone-50 rounded-xl p-4 mt-4">
                    <h3 className="font-medium text-stone-700 mb-2">Current Data</h3>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="bg-white rounded-lg p-3 border border-stone-200">
                        <div className="text-2xl font-bold text-amber-600">{guests.length}</div>
                        <div className="text-stone-500">Primary Guests</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-stone-200">
                        <div className="text-2xl font-bold text-amber-600">{guests.reduce((acc, g) => acc + (g.plusOnes?.length || 0), 0)}</div>
                        <div className="text-stone-500">Plus Ones</div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                    <div>
                      <h4 className="font-medium text-emerald-800">Load from CSV (Safe)</h4>
                      <p className="text-sm text-emerald-700 mt-1">Only loads if database is empty. <strong>Preserves existing check-ins.</strong></p>
                    </div>
                    <button onClick={m.handleBootstrap} disabled={m.dataLoading} className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                      {m.dataLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                      Bootstrap from CSV
                    </button>
                  </div>

                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                    <div>
                      <h4 className="font-medium text-red-800">Force Reload (Destructive)</h4>
                      <p className="text-sm text-red-700 mt-1">Clears ALL data including check-ins and reloads fresh from CSV.</p>
                    </div>
                    <button onClick={m.handleForceReload} disabled={m.dataLoading} className="w-full bg-red-600 text-white py-2.5 rounded-xl font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                      {m.dataLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
                      Reset &amp; Reload from CSV
                    </button>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-800"><strong>How check-ins persist:</strong> All check-ins are saved to Redis immediately. They persist across page refreshes and device switches. Only a Force Reload or new CSV import will clear them.</p>
                  </div>
                </div>
              )}

              {/* ── Games tab ── */}
              {m.activeTab === 'games' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-r from-pink-50 to-purple-50 border border-purple-200 rounded-xl p-4">
                    <h3 className="font-medium text-purple-800 mb-3 flex items-center gap-2">Best Dressed</h3>
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-white rounded-lg p-3 border border-purple-100">
                        <div className="text-2xl font-bold text-purple-600">{m.bestDressedTotalVotes}</div>
                        <div className="text-purple-500 text-sm">Total Votes</div>
                      </div>
                      <div className="bg-white rounded-lg p-3 border border-purple-100">
                        <div className="text-2xl font-bold text-purple-600">{m.bestDressedLeaderboard.length}</div>
                        <div className="text-purple-500 text-sm">Nominees</div>
                      </div>
                    </div>
                    {m.bestDressedLeaderboard.length > 0 && (
                      <div className="bg-white rounded-lg border border-purple-100 overflow-hidden mb-4">
                        <div className="px-3 py-2 bg-purple-50 text-xs font-medium text-purple-600">Top 5</div>
                        {m.bestDressedLeaderboard.slice(0, 5).map((entry, i) => (
                          <div key={`${entry.name}-${i}`} className="px-3 py-2 flex justify-between items-center border-t border-purple-50">
                            <span className="text-sm">{i + 1}. {entry.name}</span>
                            <span className="text-sm font-medium text-purple-600">{entry.count}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button onClick={m.fetchBestDressedData} className="w-full py-2 text-sm text-purple-600 hover:text-purple-800 transition-colors">Refresh</button>
                  </div>

                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                    <div>
                      <h4 className="font-medium text-red-800">Clear Best Dressed Votes</h4>
                      <p className="text-sm text-red-700 mt-1">Permanently deletes all votes. Cannot be undone.</p>
                    </div>
                    <button onClick={m.handleWipeBestDressed} disabled={m.gamesLoading} className="w-full bg-red-600 text-white py-2.5 rounded-xl font-medium hover:bg-red-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                      {m.gamesLoading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                      Clear All Votes
                    </button>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <p className="text-sm text-blue-800"><strong>Testing tip:</strong> To re-test voting from your own device, clear your browser&apos;s localStorage (Developer Tools &gt; Application &gt; Local Storage &gt; Clear).</p>
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
