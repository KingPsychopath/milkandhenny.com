'use client';

import { SearchFilter } from '@/lib/guests/types';

type SearchBarProps = {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filter: SearchFilter;
  onFilterChange: (filter: SearchFilter) => void;
  searchStats: { invites: number; plusOnes: number };
};

const filterOptions: { value: SearchFilter; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: '👥' },
  { value: 'invites', label: 'Invites', icon: '🎫' },
  { value: 'plusOnes', label: 'Guests', icon: '➕' },
  { value: 'checkedIn', label: 'Inside', icon: '✅' },
  { value: 'notCheckedIn', label: 'Waiting', icon: '⏳' },
];

export function SearchBar({
  searchQuery,
  onSearchChange,
  filter,
  onFilterChange,
  searchStats,
}: SearchBarProps) {
  const totalResults = searchStats.invites + searchStats.plusOnes;

  return (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-stone-200">
      <div className="p-4 pb-3">
        {/* Search input */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search guests..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full px-5 py-3.5 pl-12 text-base bg-stone-50 border border-stone-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent focus:bg-white transition-all placeholder:text-stone-400"
            aria-label="Search guests by name"
          />
          <svg
            className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-stone-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 text-stone-400 hover:text-stone-600 p-1"
              aria-label="Clear search"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1 scrollbar-hide">
          {filterOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onFilterChange(option.value)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl whitespace-nowrap transition-all active:scale-95 ${
                filter === option.value
                  ? 'bg-amber-600 text-white shadow-md shadow-amber-200'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
              aria-pressed={filter === option.value}
            >
              <span>{option.icon}</span>
              {option.label}
            </button>
          ))}
        </div>

        {/* Search results count */}
        {searchQuery && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-stone-500">Found</span>
            <span className="font-semibold text-stone-800">{totalResults}</span>
            <span className="text-stone-500">
              ({searchStats.invites} invite{searchStats.invites !== 1 ? 's' : ''}, {searchStats.plusOnes} guest
              {searchStats.plusOnes !== 1 ? 's' : ''})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

